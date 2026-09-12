import { probeObservedRequest } from '../capture/observed-request';
import { verifyCurrentPath, type GraphMessage } from '../capture/graph';
import { imageManifest } from '../render/conversation';
import { expandCitations } from '../render/citations';
import { canonicalizeImages } from '../render/markdown';
import { Snapshot, stableJson, type SnapshotData } from '../core/schema';
import { ProbeError } from '../shared/errors';
import type { CaptureState } from './inbox-types';

const previous = globalThis.aiInboxCapture;
if (!previous || ['success', 'error'].includes(previous.stage) || Date.now() - previous.started > 15 * 60 * 1000) {
  const state: CaptureState = { id: crypto.randomUUID(), pageUrl: location.href, started: Date.now(), stage: 'reading', bytes: {} };
  globalThis.aiInboxCapture = state;
  void capture(state).catch((error: unknown) => {
    state.stage = 'error'; state.code = error instanceof ProbeError ? error.code : 'CAPTURE_FAILED'; state.bytes = {}; delete state.snapshot;
  });
  setTimeout(() => { if (globalThis.aiInboxCapture === state) globalThis.aiInboxCapture = undefined; state.bytes = {}; delete state.snapshot; }, 15 * 60 * 1000);
}
async function capture(state: CaptureState) {
  const match = /^https:\/\/chatgpt\.com\/c\/([A-Za-z0-9-]+)\/?$/.exec(state.pageUrl);
  if (!match) throw new ProbeError('UNSUPPORTED_PAGE', 'Open an ordinary ChatGPT conversation');
  const id = match[1]!;
  const visibleIds = () => Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role]'), node => node.dataset.messageId ?? '');
  const initialVisible = visibleIds();
  const checkPage = () => {
    if (location.href !== state.pageUrl || stableJson(visibleIds()) !== stableJson(initialVisible)) throw new ProbeError('SOURCE_CHANGED', 'Conversation changed');
    if (document.querySelector('[data-testid="stop-button"]')) throw new ProbeError('SOURCE_GENERATING', 'Reply is unfinished');
    if (Date.now() - state.started > 14 * 60 * 1000) throw new ProbeError('CAPTURE_TIMEOUT', 'Capture timed out');
  };
  checkPage();
  const request = () => probeObservedRequest({ pageUrl: state.pageUrl, enableToolImages: true,
    scripts: Array.from(document.scripts, script => script.textContent ?? ''),
    resources: performance.getEntriesByType('resource').filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
      .map(entry => ({ name: entry.name, initiatorType: entry.initiatorType })),
  });
  const sourceMessages = (result: Awaited<ReturnType<typeof request>>, phase: 'reading' | 'checking' = 'reading'): GraphMessage[] => {
    state.diagnostics = { adapterVersion: 2, phase, httpStatus: result.diagnostics.httpStatus,
      requestCode: result.diagnostics.error, validation: result.messageList?.diagnostics ?? null };
    if (result.diagnostics.error) {
      const code = result.diagnostics.error === 'CURRENT_CHAT_MESSAGE_ARRAY_UNVERIFIED'
        ? result.messageList?.diagnostics.issues[0] ?? result.diagnostics.error : result.diagnostics.error;
      throw new ProbeError(code, 'Conversation response is unverified');
    }
    if (result.messageList?.diagnostics.validated) return result.messageList.messages;
    if (result.graphs.length === 1) return verifyCurrentPath(result.graphs[0], id, true).messages;
    throw new ProbeError('NO_VALIDATED_CONVERSATION_SOURCE', 'Conversation source is unavailable');
  };
  const first = await request(); const messages = sourceMessages(first);
  const ordinary = messages.filter(message => message.sourceKind !== 'tool-image');
  const positions = initialVisible.map(visible => ordinary.findIndex(message => message.id === visible));
  if (!positions.length || positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]!)) || positions.at(-1) !== ordinary.length - 1) {
    throw new ProbeError('VISIBLE_CHAIN_NOT_CONFIRMED', 'The selected branch does not match the page');
  }
  // Expand references once per message, preserving code/TeX and source order.
  const expanded = messages.map(message => {
    let lastText = -1; message.parts.forEach((part, index) => { if (part.type === 'text') lastText = index; });
    return { id: message.id, role: message.role, parts: message.parts.map((part, index) => part.type === 'text'
      ? { ...part, text: expandCitations(part.text, message.contentReferences, index === lastText) } : part) };
  });
  const manifest = imageManifest(expanded); const digests = new Map<string, string>();
  if (manifest.length > 1000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many images');
  state.stage = 'images'; state.count = 0; state.total = manifest.length;
  let byteLength = 0; const assets: SnapshotData['assets'] = [];
  for (const image of manifest) {
    checkPage(); if (!first.downloadImage) throw new ProbeError('IMAGE_RESOLVER_UNAVAILABLE', 'Image resolver unavailable');
    const downloaded = await first.downloadImage(image.reference);
    const bitmap = await createImageBitmap(new Blob([downloaded.bytes.slice().buffer], { type: downloaded.mime })); bitmap.close();
    const digest = await crypto.subtle.digest('SHA-256', downloaded.bytes.slice().buffer);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    digests.set(image.reference, sha256);
    if (!state.bytes[sha256]) {
      byteLength += downloaded.bytes.length; if (byteLength > 250 * 1024 * 1024) throw new ProbeError('LIMIT_EXCEEDED', 'Images exceed total budget');
      state.bytes[sha256] = downloaded.bytes;
      assets.push({ sha256, mime: downloaded.mime, byteLength: downloaded.bytes.length });
    }
    state.count++;
  }
  state.stage = 'checking'; checkPage();
  const final = await request();
  if (stableJson(sourceMessages(final, 'checking')) !== stableJson(messages) || final.sourceTitle !== first.sourceTitle) throw new ProbeError('SOURCE_CHANGED', 'Source changed during image download');
  checkPage();
  state.snapshot = Snapshot.parse({ schemaVersion: 1, conversationId: id, sourceUrl: `https://chatgpt.com/c/${id}`,
    title: first.sourceTitle || document.title.replace(/\s*[-|]\s*ChatGPT$/, ''), capturedAt: new Date().toISOString(),
    messages: expanded.map(message => ({ ...message, parts: message.parts.map(part => part.type === 'text'
      ? { type: 'text', text: canonicalizeImages(part.text, digests) }
      : { type: 'image', sha256: digests.get(part.pointer), ...(part.alt ? { alt: part.alt } : {}) }) })), assets });
  state.stage = 'success';
}
