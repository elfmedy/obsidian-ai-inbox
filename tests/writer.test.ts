import { DEFAULT_EXPORT_OPTIONS, type ExportOptionsData } from '../src/shared/export-options';
import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { InboxWriter, type VaultStore } from '../src/core/writer';
import { type SaveRequestData } from '../src/core/schema';
import { ProbeError } from '../src/shared/errors';
import { FIXTURE_PNG, FIXTURE_HASH } from './fixtures/image';

class MemoryVault implements VaultStore {
  files = new Map<string, string>(); binaries = new Map<string, Uint8Array>(); buffers = new Map<string, string[]>();
  state: unknown; stateWrites = 0; failStateAt = -1; race: (() => void) | undefined;
  async read(path: string) { return this.files.get(path) ?? null; }
  async create(path: string, text: string) { if (this.files.has(path)) throw new ProbeError('PATH_EXISTS', 'Exists'); this.files.set(path, text); }
  async replace(path: string, expected: string, text: string, guard: () => boolean) {
    this.race?.(); this.race = undefined;
    if (this.files.get(path) !== expected || !guard()) throw new ProbeError('REPLAN_REQUIRED', 'Changed'); this.files.set(path, text);
  }
  editor(path: string) { return this.buffers.get(path) ?? []; }
  markdownPaths() { return [...this.files.keys()]; }
  async readBinary(path: string) { return this.binaries.get(path) ?? null; }
  async createBinary(path: string, bytes: Uint8Array) { this.binaries.set(path, bytes.slice()); }
  attachmentFolder = 'AI Inbox/_assets'; attachmentSources: string[] = [];
  async attachmentPath(filename: string, sourcePath: string) {
    this.attachmentSources.push(sourcePath);
    const parent = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
    const folder = (this.attachmentFolder.startsWith('./') ? parent + this.attachmentFolder.slice(2) : this.attachmentFolder).replace(/\/$/, '');
    const path = `${folder ? folder + '/' : ''}${filename}`;
    return this.binaries.has(path) ? path.replace(/\.(\w+)$/, `-${randomUUID()}.$1`) : path;
  }
  async saveState(state: unknown) { if (++this.stateWrites === this.failStateAt) throw new Error('Disk failure'); this.state = structuredClone(state); }
}
function request(revision = 0, text = 'Original'): SaveRequestData {
  return { requestId: randomUUID(), expectedRevision: revision, snapshot: { schemaVersion: 1, conversationId: 'chat-1',
    sourceUrl: 'https://chatgpt.com/c/chat-1', title: 'Title', capturedAt: '2026-09-12T00:00:00.000Z',
    messages: [{ id: 'message-1', role: 'user', parts: [{ type: 'text', text }] }], assets: [] } };
}
describe('durable save policy', () => {
  it.each(['', 'Attachments', './', './images'])('uses attachment setting %j relative to the saved note', async folder => {
    const vault = new MemoryVault(); vault.attachmentFolder = folder;
    const writer = new InboxWriter(vault, null); const data = request();
    data.snapshot.assets.push(await writer.upload(FIXTURE_PNG, FIXTURE_HASH));
    data.snapshot.messages[0]!.parts.push({ type: 'image', sha256: FIXTURE_HASH });
    expect(vault.binaries.size).toBe(0);
    const first = await writer.save(data);
    const expected = (folder.startsWith('./') ? 'AI Inbox/' + folder.slice(2) : folder).replace(/\/$/, '');
    const path = [...vault.binaries.keys()][0]!;
    expect(path).toBe(`${expected ? expected + '/' : ''}${FIXTURE_HASH}.png`);
    expect(vault.attachmentSources).toEqual([first.path]); expect(vault.files.get(first.path)).toContain(path);
    vault.attachmentFolder = 'Different'; data.requestId = randomUUID(); data.expectedRevision = 1;
    expect((await writer.save(data)).action).toBe('unchanged'); expect(vault.binaries.size).toBe(1);
  });
  it('keeps existing attachments and places new images relative to a moved note; forks use the new note path', async () => {
    const vault = new MemoryVault(); vault.attachmentFolder = './images';
    const writer = new InboxWriter(vault, null); const data = request();
    data.snapshot.assets.push(await writer.upload(FIXTURE_PNG, FIXTURE_HASH));
    data.snapshot.messages[0]!.parts.push({ type: 'image', sha256: FIXTURE_HASH });
    const first = await writer.save(data);
    const moved = 'Moved/renamed.md'; vault.files.set(moved, vault.files.get(first.path)!); vault.files.delete(first.path);
    const secondBytes = new Uint8Array([...FIXTURE_PNG, 0]); const secondHash = createHash('sha256').update(secondBytes).digest('hex');
    data.snapshot.assets.push(await writer.upload(secondBytes, secondHash)); data.snapshot.messages[0]!.parts.push({ type: 'image', sha256: secondHash });
    data.requestId = randomUUID(); data.expectedRevision = 1;
    expect((await writer.save(data)).path).toBe(moved); expect(vault.attachmentSources.at(-1)).toBe(moved);
    expect(vault.files.get(moved)).toContain(`Moved/images/${secondHash}.png`);
    expect(vault.files.get(moved)).toContain(`AI Inbox/images/${FIXTURE_HASH}.png`);
    vault.files.set(moved, vault.files.get(moved)! + '\nLocal edit'); await writer.configureFolder('New Inbox', async () => undefined);
    data.requestId = randomUUID(); data.expectedRevision = 2;
    const fork = await writer.save(data); expect(fork.action).toBe('forked');
    expect(vault.attachmentSources.slice(-2)).toEqual([fork.path, fork.path]);
    expect(vault.files.get(fork.path)).toContain(`New Inbox/images/${FIXTURE_HASH}.png`);
    expect(vault.files.get(moved)).toContain('Local edit');
  });
  it('supports replaying browser-owned uploads after the receiver restarts before commit', async () => {
    const vault = new MemoryVault(); const first = new InboxWriter(vault, null); const data = request();
    data.snapshot.assets.push(await first.upload(FIXTURE_PNG, FIXTURE_HASH)); data.snapshot.messages[0]!.parts.push({ type: 'image', sha256: FIXTURE_HASH });
    const restarted = new InboxWriter(vault, vault.state);
    await expect(restarted.save(data)).rejects.toMatchObject({ code: 'ASSET_MISSING' });
    await restarted.upload(FIXTURE_PNG, FIXTURE_HASH);
    expect((await restarted.save(data)).action).toBe('created'); expect(vault.binaries.size).toBe(1);
  });
  it('creates, deduplicates exact requests, no-ops same source, and updates changed source', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = request();
    const receipt = await writer.save(first); const original = vault.files.get(receipt.path);
    expect(await writer.save(first)).toEqual(receipt); expect(vault.files.size).toBe(1);
    expect((await writer.save(request(1))).action).toBe('unchanged'); expect(vault.files.get(receipt.path)).toBe(original);
    expect((await writer.save(request(2, 'New source'))).action).toBe('updated'); expect(vault.files.get(receipt.path)).toContain('New source');
  });
  it('forks local edits even with unchanged source and makes the fork the next target', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null);
    const first = await writer.save(request()); vault.files.set(first.path, vault.files.get(first.path)! + '\nMy edits');
    const fork = await writer.save(request(1)); expect(fork.action).toBe('forked'); expect(fork.path).toContain('2026');
    expect(vault.files.get(first.path)).toContain('My edits');
    const next = await writer.save(request(2, 'Next')); expect(next.path).toBe(fork.path); expect(next.action).toBe('updated');
  });
  it('follows renamed/moved notes and preserves YAML byte for byte', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = await writer.save(request());
    const withYaml = vault.files.get(first.path)!.replace('source: chatgpt', 'source: chatgpt\n# my comment\ntags: [custom]\nquoted: "keep: this"');
    vault.files.delete(first.path); vault.files.set('Moved/renamed.md', withYaml);
    const receipt = await writer.save(request(1, 'Changed'));
    expect(receipt.path).toBe('Moved/renamed.md'); expect(receipt.action).toBe('updated');
    expect(vault.files.get(receipt.path)!.split('---')[1]).toBe(withYaml.split('---')[1]);
  });
  it('protects dirty editor buffers and rejects a racing revision', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = await writer.save(request());
    vault.buffers.set(first.path, [vault.files.get(first.path)! + '\nUnsaved']);
    const results = await Promise.allSettled([writer.save(request(1)), writer.save(request(1))]);
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
    expect(vault.files.size).toBe(2); expect(vault.buffers.get(first.path)![0]).toContain('Unsaved');
  });
  it('applies a changed Inbox only to newly created notes', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = await writer.save(request());
    await writer.configureFolder('Archive/Chats', async () => undefined);
    expect((await writer.save(request(1, 'Updated'))).path).toBe(first.path);
    vault.files.set(first.path, vault.files.get(first.path)! + '\nLocal');
    expect((await writer.save(request(2, 'Updated'))).path).toMatch(/^Archive\/Chats\//);
    await expect(writer.configureFolder('../escape', async () => undefined)).rejects.toMatchObject({ code: 'FOLDER_INVALID' });
  });
  it('treats editor CRLF normalization as unchanged and protects incomplete YAML edits', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = await writer.save(request());
    const lf = vault.files.get(first.path)!; vault.files.set(first.path, lf.replace(/\n/g, '\r\n')); vault.buffers.set(first.path, [lf]);
    expect((await writer.save(request(1))).action).toBe('unchanged');
    vault.buffers.set(first.path, ['---\nUnfinished frontmatter']);
    expect((await writer.save(request(2))).action).toBe('forked'); expect(vault.buffers.get(first.path)).toEqual(['---\nUnfinished frontmatter']);
  });
  it('recovers an interrupted acknowledgement without creating another note', async () => {
    const vault = new MemoryVault(); vault.failStateAt = 2; const writer = new InboxWriter(vault, null); const data = request();
    await expect(writer.save(data)).rejects.toThrow('Disk failure'); expect(vault.files.size).toBe(1);
    const restarted = new InboxWriter(vault, vault.state); await restarted.ready();
    expect((await restarted.save(data)).action).toBe('created'); expect(vault.files.size).toBe(1);
    expect(restarted.status(data.requestId)?.revision).toBe(1);
  });
  it('recovers conservatively into a new note if the first write was edited before restart', async () => {
    const vault = new MemoryVault(); vault.failStateAt = 2; const writer = new InboxWriter(vault, null); const data = request();
    await expect(writer.save(data)).rejects.toThrow('Disk failure'); const path = [...vault.files.keys()][0]!;
    const edited = vault.files.get(path)! + '\nEdit after crash'; vault.files.set(path, edited);
    const restarted = new InboxWriter(vault, vault.state); await restarted.ready();
    const receipt = await restarted.save(data); expect(receipt.action).toBe('forked'); expect(receipt.path).not.toBe(path);
    expect(vault.files.get(path)).toBe(edited); expect(vault.files.size).toBe(2);
    expect(await restarted.save(data)).toEqual(receipt); expect(vault.files.size).toBe(2);
  });
  it('allows a safe retry after the disk changes immediately before replacement', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const first = await writer.save(request());
    vault.race = () => { vault.files.set(first.path, vault.files.get(first.path)! + '\nRacing edit'); };
    await expect(writer.save(request(1, 'Changed'))).rejects.toMatchObject({ code: 'REPLAN_REQUIRED' });
    expect((await writer.save(request(1, 'Changed'))).action).toBe('forked');
    expect(vault.files.get(first.path)).toContain('Racing edit');
  });
  it('refuses request ID reuse with different content', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const data = request(); await writer.save(data);
    data.snapshot.title = 'Other'; await expect(writer.save(data)).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
  });
  it('preserves edited images, uploads a fresh asset, and forks its note', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null); const data = request();
    const asset = await writer.upload(FIXTURE_PNG, FIXTURE_HASH); data.snapshot.assets.push(asset);
    data.snapshot.messages[0]!.parts.push({ type: 'image', sha256: FIXTURE_HASH });
    const first = await writer.save(data); const path = [...vault.binaries.keys()][0]!;
    vault.binaries.set(path, new Uint8Array([1, 2, 3])); await writer.upload(FIXTURE_PNG, FIXTURE_HASH);
    data.requestId = randomUUID(); data.expectedRevision = 1;
    expect((await writer.save(data)).action).toBe('forked'); expect(vault.binaries.get(path)).toEqual(new Uint8Array([1, 2, 3]));
    expect(vault.files.get(first.path)).toContain(path); expect(vault.binaries.size).toBe(2);
  });
});


describe('content settings at save time', () => {
  it('updates an untouched note after title preference changes even when source is unchanged', async () => {
    const vault = new MemoryVault(); let options = { ...DEFAULT_EXPORT_OPTIONS };
    const writer = new InboxWriter(vault, null, 'AI Inbox', () => options);
    const first = await writer.save(request()); expect(vault.files.get(first.path)).not.toContain('# Title');
    options = { ...options, includeTitle: true };
    const second = await writer.save(request(1)); expect(second.action).toBe('updated');
    expect(vault.files.get(first.path)).toContain('# Title');
    expect((await writer.save(request(2))).action).toBe('unchanged');
    options = { ...options, includeTitle: false };
    expect((await writer.save(request(3))).action).toBe('updated');
    expect(vault.files.get(first.path)).not.toContain('# Title');
  });
  it('forks instead of overwriting local edits when content preferences change', async () => {
    const vault = new MemoryVault(); let options = { ...DEFAULT_EXPORT_OPTIONS };
    const writer = new InboxWriter(vault, null, 'AI Inbox', () => options);
    const first = await writer.save(request()); const edited = vault.files.get(first.path)! + '\nLocal edits'; vault.files.set(first.path, edited);
    options = { ...options, includeTitle: true };
    const second = await writer.save(request(1)); expect(second.action).toBe('forked');
    expect(vault.files.get(first.path)).toBe(edited); expect(vault.files.get(second.path)).toContain('# Title');
  });
  it('writes requested thinking in collapsed callouts and removes it on the next save when disabled', async () => {
    const vault = new MemoryVault(); let options: ExportOptionsData = { ...DEFAULT_EXPORT_OPTIONS, includeThinking: true, language: 'en' };
    const writer = new InboxWriter(vault, null, 'AI Inbox', () => options);
    const data = request(); data.exportOptions = options;
    data.snapshot.messages.push({ id: 'thinking', role: 'assistant', kind: 'thinking', parts: [{ type: 'text', text: 'Synthetic thought\n\n- Detail' }] });
    const first = await writer.save(data); const body = vault.files.get(first.path)!;
    expect(body).toContain('> [!note]- Thinking\n> Synthetic thought\n> \n> - Detail');
    expect(body).toContain('## User');
    options = { ...options, includeThinking: false };
    const second = await writer.save({ ...data, requestId: randomUUID(), expectedRevision: 1, exportOptions: options });
    expect(second.action).toBe('updated'); expect(vault.files.get(first.path)).not.toContain('Synthetic thought');
  });
  it('rejects stale capture settings before writing, but returns an already committed receipt unchanged', async () => {
    const vault = new MemoryVault(); let options = { ...DEFAULT_EXPORT_OPTIONS };
    const writer = new InboxWriter(vault, null, 'AI Inbox', () => options);
    const data = { ...request(), exportOptions: options }; const first = await writer.save(data);
    options = { ...options, includeTitle: true };
    expect(await writer.save(data)).toEqual(first);
    await expect(writer.save({ ...data, requestId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ code: 'EXPORT_SETTINGS_CHANGED' });
    expect(vault.files.size).toBe(1); expect(writer.revision('chat-1')).toBe(1);
  });
  it('requires a capable extension when thinking export is enabled', async () => {
    const vault = new MemoryVault(); const writer = new InboxWriter(vault, null, 'AI Inbox', () => ({ ...DEFAULT_EXPORT_OPTIONS, includeThinking: true }));
    await expect(writer.save(request())).rejects.toMatchObject({ code: 'EXTENSION_UPDATE_REQUIRED' }); expect(vault.files.size).toBe(0);
  });
});
