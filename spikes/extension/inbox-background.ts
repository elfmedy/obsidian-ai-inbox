import { createMenuUpdater } from './inbox-menus';
import { ExportOptions } from '../shared/export-options';
import { z } from 'zod';
import { Snapshot } from '../core/schema';
import { ProbeError } from '../shared/errors';
import { receiver } from './inbox-connection';
import { selectVault, vaultOverview } from './inbox-vaults';
import { jobStore, queuedFor } from './inbox-storage';
import type { Connection, Feedback, Job } from './inbox-types';
import { CaptureFailure } from './inbox-types';

const busy = new Set<number>();
const conversationBusy = new Set<string>();
const runPages = new Map<number, string>();
const Receipt = z.object({ requestId: z.uuid(), action: z.enum(['created', 'updated', 'forked', 'unchanged']), path: z.string().max(4096),
  noteId: z.uuid(), revision: z.number().int().nonnegative(), messages: z.number().int().nonnegative(), images: z.number().int().nonnegative() });
const supported = (url: string | undefined) => !!url && /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+\/?$/.test(url);

async function feedback(tabId: number, data: Feedback, fallback = false) {
  const pageUrl = data.pageUrl ?? runPages.get(tabId); if (pageUrl) data = { ...data, pageUrl };
  await chrome.storage.local.set({ [`status:${tabId}`]: data, lastStatus: data });
  try {
    if (pageUrl && (await chrome.tabs.get(tabId)).url !== pageUrl) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['inbox-card.js'] });
    const stored = await chrome.storage.local.get('preferences');
    const language = (stored.preferences as { language?: string } | undefined)?.language ?? 'auto';
    await chrome.tabs.sendMessage(tabId, { type: 'feedback', data, language });
  } catch { if (fallback) await openStatus(tabId); }
}
async function openStatus(tabId?: number) {
  const url = chrome.runtime.getURL(`status.html${tabId !== undefined ? `?tab=${tabId}` : ''}`);
  const existing = (await chrome.tabs.query({ url: `${chrome.runtime.getURL('status.html')}*` }))[0];
  if (existing?.id !== undefined) await chrome.tabs.update(existing.id, { url, active: true }); else await chrome.tabs.create({ url });
}
async function prepare(tabId: number, pageUrl: string, connection: Connection): Promise<Job> {
  const id = new URL(pageUrl).pathname.split('/')[2]!;
  const revision = z.object({ revision: z.number().int().nonnegative() }).parse(await receiver(connection, `v1/conversations/${id}`)).revision;
  const exportOptions = await receiver(connection, 'v1/export-options').catch(error => {
    if (error instanceof ProbeError && error.code === 'NOT_FOUND') throw new ProbeError('PLUGIN_UPDATE_REQUIRED', 'Update the Obsidian plugin');
    throw error;
  }).then(value => ExportOptions.parse(value));
  await chrome.scripting.executeScript({ target: { tabId }, func: includeThinking => { globalThis.aiInboxCaptureOptions = { includeThinking }; }, args: [exportOptions.includeThinking] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['inbox-capture.js'] });
  const deadline = Date.now() + 15 * 60 * 1000;
  let captureId = '';
  while (true) {
    if (Date.now() > deadline) throw new ProbeError('CAPTURE_TIMEOUT', 'Capture timed out');
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const state = globalThis.aiInboxCapture;
      return state ? { id: state.id, pageUrl: state.pageUrl, stage: state.stage, count: state.count, total: state.total, code: state.code,
        diagnostics: state.stage === 'error' ? state.diagnostics : undefined } : null;
    } });
    const state = result[0]?.result;
    if (!state || state.pageUrl !== pageUrl || (captureId && captureId !== state.id)) throw new ProbeError('CAPTURE_LOST', 'Capture context changed');
    captureId = state.id;
    if (state.stage === 'error') throw new CaptureFailure(state.code ?? 'CAPTURE_FAILED', state.diagnostics);
    if (state.stage === 'success') break;
    await feedback(tabId, { stage: state.stage, ...(state.count !== undefined ? { count: state.count } : {}), ...(state.total !== undefined ? { total: state.total } : {}) });
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const payload = await chrome.scripting.executeScript({ target: { tabId }, func: expectedId => {
    const state = globalThis.aiInboxCapture; return state?.id === expectedId && location.href === state.pageUrl ? state.snapshot : null;
  }, args: [captureId] });
  const snapshot = Snapshot.parse(payload[0]?.result);
  const job: Job = { tabId, pageUrl, vaultId: connection.vaultId, request: { requestId: crypto.randomUUID(), expectedRevision: revision, snapshot, exportOptions }, bytes: {} };
  await feedback(tabId, { stage: 'transferring', count: 0, total: snapshot.assets.length });
  for (const [index, asset] of snapshot.assets.entries()) {
    const bytes = new Uint8Array(asset.byteLength);
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      const part = await chrome.scripting.executeScript({ target: { tabId }, func: (expectedId: string, digest: string, position: number) => {
        const state = globalThis.aiInboxCapture;
        if (!state || state.id !== expectedId || location.href !== state.pageUrl) return null;
        const image = state.bytes[digest]; if (!image) return null;
        return btoa(Array.from(image.subarray(position, position + 64 * 1024), byte => String.fromCharCode(byte)).join(''));
      }, args: [captureId, asset.sha256, offset] });
      const encoded = part[0]?.result; if (!encoded) throw new ProbeError('CAPTURE_LOST', 'Image data unavailable');
      const decoded = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      if (decoded.length !== Math.min(64 * 1024, bytes.length - offset)) throw new ProbeError('ASSET_INVALID', 'Image chunk differs'); bytes.set(decoded, offset);
    }
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new ProbeError('ASSET_INVALID', 'Transferred image differs'); job.bytes[digest] = bytes;
    await feedback(tabId, { stage: 'transferring', count: index + 1, total: snapshot.assets.length });
  }
  // A durable outbox precedes every server mutation. It contains canonical
  // image digests/bytes, never ChatGPT credentials or signed image URLs.
  await jobStore(tabId, 'put', job);
  await chrome.scripting.executeScript({ target: { tabId }, func: expectedId => {
    if (globalThis.aiInboxCapture?.id === expectedId) globalThis.aiInboxCapture = undefined;
  }, args: [captureId] }).catch(() => undefined);
  return job;
}
async function submit(tabId: number, job: Job, connection: Connection, vaultName: string, recovering: boolean) {
  if (job.vaultId !== connection.vaultId) throw new ProbeError('PENDING_VAULT_MISMATCH', 'Unfinished save belongs to another vault');
  let receipt;
  if (recovering) {
    await feedback(tabId, { stage: 'recovering' });
    receipt = z.object({ receipt: Receipt.nullable() }).parse(await receiver(connection, `v1/requests/${job.request.requestId}`)).receipt;
  }
  if (!receipt) {
    for (const [index, asset] of job.request.snapshot.assets.entries()) {
      await feedback(tabId, { stage: 'transferring', count: index, total: job.request.snapshot.assets.length });
      const bytes = job.bytes[asset.sha256]; if (!bytes) throw new ProbeError('LOCAL_QUEUE_INVALID', 'Queued image missing');
      const response = z.object({ sha256: z.string(), byteLength: z.number(), mime: z.string() }).parse(await receiver(connection, `v1/assets/${asset.sha256}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.slice().buffer }));
      if (response.sha256 !== asset.sha256 || response.byteLength !== asset.byteLength || response.mime !== asset.mime) throw new ProbeError('RECEIPT_INVALID', 'Image receipt differs');
    }
    await feedback(tabId, { stage: 'saving' });
    receipt = Receipt.parse(await receiver(connection, 'v1/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job.request) }));
  }
  if (receipt.requestId !== job.request.requestId) throw new ProbeError('RECEIPT_INVALID', 'Save receipt differs');
  await feedback(tabId, { stage: 'success', receipt, vaultName }); await jobStore(job.tabId, 'delete');
}
async function save(tab: chrome.tabs.Tab) {
  const tabId = tab.id; if (tabId === undefined) return;
  if (busy.has(tabId)) {
    const current = await chrome.storage.local.get(`status:${tabId}`);
    if (current[`status:${tabId}`]) await feedback(tabId, current[`status:${tabId}`] as Feedback); return;
  }
  busy.add(tabId);
  if (supported(tab.url)) runPages.set(tabId, tab.url!);
  let key: string | undefined; let queued: Job | undefined;
  let began = false; let connected = false;
  try {
    if (!supported(tab.url)) throw new ProbeError('UNSUPPORTED_PAGE', 'Open an ordinary ChatGPT conversation');
    await feedback(tabId, { stage: 'connecting' }, true); began = true;
    const { connection, vaultName } = await selectVault(undefined, async progress => {
      await feedback(tabId, { stage: 'pairing', pairCode: progress.code, vaultName: progress.vaultName });
    });
    connected = true;
    key = `${connection.vaultId}:${tab.url!}`;
    if (conversationBusy.has(key)) { key = undefined; throw new ProbeError('CONVERSATION_BUSY', 'Another tab is saving this conversation'); }
    conversationBusy.add(key);
    queued = await queuedFor(tab.url!, connection.vaultId);
    // A Chrome tab ID can be reused after restart. Do not replace a different
    // unfinished chat's durable outbox slot.
    if (!queued && await jobStore(tabId, 'get')) throw new ProbeError('PENDING_CHAT_MISMATCH', 'This tab ID has another unfinished save');
    const job = queued ?? await prepare(tabId, tab.url!, connection);
    await submit(tabId, job, connection, vaultName, !!queued);
  } catch (error) {
    const code = error instanceof ProbeError ? error.code : connected ? 'CONNECTION_OR_SAVE_FAILED' : 'OBSIDIAN_UNAVAILABLE';
    // These codes explicitly certify that no note commit took place.
    if (['REVISION_CONFLICT', 'REPLAN_REQUIRED', 'SNAPSHOT_INVALID', 'ASSET_MANIFEST_MISMATCH', 'EXPORT_SETTINGS_CHANGED', 'EXTENSION_UPDATE_REQUIRED'].includes(code)) await jobStore(queued?.tabId ?? tabId, 'delete').catch(() => undefined);
    const details = error instanceof CaptureFailure ? { notSubmitted: true, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) } : {};
    await feedback(tabId, { stage: 'error', code, ...details }, !began && code !== 'CONNECTION_REQUIRED').catch(() => undefined);
    // Finish feedback while the chat is still active. Opening the chooser
    // first can suspend injection into the background tab and retain its lock.
    if (code === 'VAULT_SELECTION_REQUIRED') void chrome.runtime.openOptionsPage().catch(() => undefined);
  } finally { busy.delete(tabId); runPages.delete(tabId); if (key) conversationBusy.delete(key); }
}
chrome.action.onClicked.addListener(tab => { void save(tab); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save' && tab) void save(tab);
  if (info.menuItemId === 'settings') void chrome.runtime.openOptionsPage();
  if (info.menuItemId === 'status') void openStatus();
});
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof message !== 'object' || !message) return;
  if ('type' in message && message.type === 'retry' && 'tabId' in message && typeof message.tabId === 'number') {
    void chrome.tabs.get(message.tabId).then(save).catch(() => undefined); reply({ accepted: true });
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if ('type' in message && message.type === 'vault-overview') {
    void vaultOverview().then(value => reply({ ok: true, ...value })).catch(error => reply({ ok: false, code: error instanceof ProbeError ? error.code : 'OBSIDIAN_UNAVAILABLE' })); return true;
  }
  if ('type' in message && message.type === 'select-vault' && 'vaultId' in message && typeof message.vaultId === 'string') {
    void selectVault(message.vaultId, async progress => { await chrome.storage.local.set({ pairingStatus: progress }); })
      .then(value => reply({ ok: true, vaultName: value.vaultName }))
      .catch(error => reply({ ok: false, code: error instanceof ProbeError ? error.code : 'OBSIDIAN_UNAVAILABLE' })); return true;
  }
});
const updateMenus = createMenuUpdater();
function refreshMenus() {
  void updateMenus().catch(error => { console.warn('AI Inbox: could not rebuild context menus. Reload the extension to retry.', error); });
}
chrome.runtime.onInstalled.addListener(() => { refreshMenus(); void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); });
chrome.runtime.onStartup.addListener(refreshMenus);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.preferences) refreshMenus(); });
