import { DEFAULT_EXPORT_OPTIONS, ExportOptions, type ExportOptionsData } from '../shared/export-options';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { decideSave, hash, normalizeBody, safeTitle, splitMarkdown, timestampName } from '../persistence/policy';
import { detectImageType } from '../assets/inspect';
import { renderConversation, imageManifest } from '../render/conversation';
import { localImage } from '../render/markdown';
import { ProbeError } from '../shared/errors';
import { Digest, parseSaveRequest, stableJson, type SaveRequestData, type SnapshotData } from './schema';

export interface VaultStore {
  read(path: string): Promise<string | null>;
  create(path: string, text: string): Promise<void>;
  replace(path: string, expected: string, text: string, guard: () => boolean): Promise<void>;
  editor(path: string): string[];
  markdownPaths(): string[];
  readBinary(path: string): Promise<Uint8Array | null>;
  createBinary(path: string, bytes: Uint8Array): Promise<void>;
  attachmentPath(filename: string, sourcePath: string): Promise<string>;
  saveState(state: unknown): Promise<void>;
}
const ReceiptSchema = z.strictObject({ requestId: z.uuid(), action: z.enum(['created', 'updated', 'forked', 'unchanged']),
  path: z.string(), noteId: z.uuid(), revision: z.number().int(), messages: z.number().int(), images: z.number().int() });
export type SaveReceipt = z.infer<typeof ReceiptSchema>;
const NoteSchema = z.strictObject({ noteId: z.uuid(), conversationId: z.string(), path: z.string(), sourceHash: Digest,
  bodyHash: Digest, assets: z.array(z.strictObject({ sha256: Digest, path: z.string() })) });
type Note = z.infer<typeof NoteSchema>;
const RequestRecord = z.strictObject({ payloadHash: Digest, receipt: ReceiptSchema });
const Pending = z.strictObject({ requestId: z.uuid(), payloadHash: Digest, note: NoteSchema, receipt: ReceiptSchema,
  before: z.string().nullable(), after: z.string() });
const StateSchema = z.strictObject({ version: z.literal(1),
  conversations: z.record(z.string(), z.strictObject({ noteId: z.uuid(), revision: z.number().int().nonnegative() })),
  notes: z.record(z.string(), NoteSchema), assets: z.record(z.string(), z.string()),
  requests: z.record(z.string(), RequestRecord), pending: Pending.nullable() });
export type WriterState = z.infer<typeof StateSchema>;
export function emptyState(): WriterState { return { version: 1, conversations: {}, notes: {}, assets: {}, requests: {}, pending: null }; }
function fail(code: string): never { throw new ProbeError(code, 'Save could not be completed safely'); }

export class InboxWriter {
  private state: WriterState;
  private tail: Promise<unknown> = Promise.resolve();
  // Browser outbox owns durable upload bytes. The receiver buffers them until
  // the final note path is known, so relative attachment settings are correct.
  private uploads = new Map<string, Uint8Array>();
  constructor(private readonly store: VaultStore, initial: unknown, private folder = 'AI Inbox', private readonly options: () => ExportOptionsData = () => DEFAULT_EXPORT_OPTIONS) {
    const parsed = StateSchema.safeParse(initial ?? emptyState());
    if (!parsed.success) fail('INDEX_INVALID');
    this.state = parsed.data;
    this.checkFolder(folder);
  }
  exportOptions() { return ExportOptions.parse(this.options()); }
  private checkFolder(folder: string) {
    if (!folder || folder.length > 120 || folder.split('/').some(part => !part || ['.', '..'].includes(part) || /[ .]$/.test(part) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)) || /[\\:[\]<>"|?*\r\n#%]/.test(folder)) fail('FOLDER_INVALID');
  }
  configureFolder(folder: string, persist: () => Promise<void>) {
    return this.serial(async () => { this.checkFolder(folder); await persist(); this.folder = folder; });
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const work = this.tail.then(action); this.tail = work.catch(() => undefined); return work;
  }
  private async persist(next: WriterState) { await this.store.saveState(next); this.state = next; }
  revision(conversationId: string): number { return this.state.conversations[conversationId]?.revision ?? 0; }
  status(requestId: string) { return this.state.requests[requestId]?.receipt ?? null; }
  private completed(state: WriterState, pending: z.infer<typeof Pending>): WriterState {
    return { ...state, pending: null, notes: { ...state.notes, [pending.note.noteId]: pending.note },
      conversations: { ...state.conversations, [pending.note.conversationId]: { noteId: pending.note.noteId, revision: pending.receipt.revision } },
      requests: { ...state.requests, [pending.requestId]: { payloadHash: pending.payloadHash, receipt: pending.receipt } } };
  }
  private async recover() {
    const pending = this.state.pending;
    if (!pending) return;
    const current = await this.store.read(pending.note.path);
    if (current === pending.after) await this.persist(this.completed(this.state, pending));
    else if (current === pending.before) await this.persist({ ...this.state, pending: null });
    else {
      for (const asset of pending.note.assets) {
        const bytes = await this.store.readBinary(asset.path);
        if (!bytes || hash(bytes) !== asset.sha256) fail('RECOVERY_ASSET_CHANGED');
      }
      // The saved file was edited/moved after the interrupted operation. Keep
      // it intact and finish this SAME request in a separately identified note.
      const noteId = randomUUID(); const title = pending.note.path.split('/').at(-1)!.replace(/\.md$/i, '');
      let path: string; let counter = 1;
      do { path = `${this.folder}/${timestampName(title, new Date(), counter++)}`; } while (await this.store.read(path) !== null);
      const after = pending.after.replace(/^ai_inbox_id:.*$/m, `ai_inbox_id: ${JSON.stringify(noteId)}`);
      if (after === pending.after) fail('RECOVERY_CONFLICT');
      const recovered = { ...pending, before: null, after, note: { ...pending.note, noteId, path },
        receipt: { ...pending.receipt, noteId, path, action: 'forked' as const } };
      await this.persist({ ...this.state, pending: recovered });
      await this.store.create(path, after);
      if (await this.store.read(path) !== after) fail('WRITE_UNVERIFIED');
      await this.persist(this.completed(this.state, recovered));
    }
  }
  ready() { return this.serial(() => this.recover()); }
  upload(bytes: Uint8Array, expectedHash: string) {
    return this.serial(async () => {
      await this.recover();
      if (bytes.length > 25 * 1024 * 1024 || hash(bytes) !== expectedHash || !Digest.safeParse(expectedHash).success) fail('ASSET_INVALID');
      const mime = detectImageType(bytes);
      const total = [...this.uploads.values()].reduce((sum, value) => sum + value.length, 0) - (this.uploads.get(expectedHash)?.length ?? 0);
      if (total + bytes.length > 250 * 1024 * 1024) fail('LIMIT_EXCEEDED');
      this.uploads.set(expectedHash, bytes.slice());
      return { sha256: expectedHash, mime, byteLength: bytes.length };
    });
  }
  save(input: unknown) { return this.serial(async () => { await this.recover(); return this.commit(parseSaveRequest(input)); }); }
  private async locate(note: Note): Promise<{ path: string; text: string } | null> {
    // Stable note identity makes rename/move independent of body edit detection.
    const matches: Array<{ path: string; text: string }> = [];
    for (const path of new Set([note.path, ...this.store.markdownPaths()])) {
      const text = await this.store.read(path); if (text === null) continue;
      let prefix: string; try { prefix = splitMarkdown(text).prefix; } catch { continue; }
      const id = /^ai_inbox_id:\s*"?([a-f0-9-]+)"?\s*$/m.exec(prefix)?.[1];
      if (id === note.noteId) matches.push({ path, text });
      if (matches.length > 1) return null;
    }
    return matches[0] ?? null;
  }
  private async assetBytes(snapshot: SnapshotData) {
    const result = new Map<string, Uint8Array>();
    for (const asset of snapshot.assets) {
      const path = this.state.assets[asset.sha256];
      const bytes = this.uploads.get(asset.sha256) ?? (path ? await this.store.readBinary(path) : null);
      if (!bytes || bytes.length !== asset.byteLength || hash(bytes) !== asset.sha256 || detectImageType(bytes) !== asset.mime) fail('ASSET_MISSING');
      result.set(asset.sha256, bytes);
    }
    return result;
  }
  private async assets(snapshot: SnapshotData, notePath: string, bytes: Map<string, Uint8Array>, retained?: Note) {
    const paths = new Map<string, string>();
    for (const asset of snapshot.assets) {
      let path = retained?.assets.find(item => item.sha256 === asset.sha256)?.path;
      if (!path) {
        const extension = asset.mime === 'image/jpeg' ? 'jpg' : asset.mime.slice(6);
        path = await this.store.attachmentPath(`${asset.sha256}.${extension}`, notePath);
        // Validate before writing. Obsidian resolves settings and collisions.
        localImage(path);
        const prior = this.state.assets[asset.sha256];
        if (prior && prior.slice(0, prior.lastIndexOf('/') + 1) === path.slice(0, path.lastIndexOf('/') + 1)) {
          const existing = await this.store.readBinary(prior);
          if (existing && hash(existing) === asset.sha256) path = prior;
        }
        const existing = await this.store.readBinary(path);
        if (existing && hash(existing) !== asset.sha256) fail('ASSET_PATH_CONFLICT');
        if (!existing) await this.store.createBinary(path, bytes.get(asset.sha256)!);
      }
      const verified = await this.store.readBinary(path);
      if (!verified || hash(verified) !== asset.sha256) fail('ASSET_WRITE_UNVERIFIED');
      paths.set(`ai-inbox-asset:${asset.sha256}`, path);
    }
    return paths;
  }
  private async commit(request: SaveRequestData): Promise<SaveReceipt> {
    const payloadHash = hash(stableJson(request));
    const prior = this.state.requests[request.requestId];
    if (prior) { if (prior.payloadHash !== payloadHash) fail('REQUEST_ID_REUSED'); return prior.receipt; }
    const exportOptions = this.exportOptions();
    if (request.exportOptions && stableJson(request.exportOptions) !== stableJson(exportOptions)) fail('EXPORT_SETTINGS_CHANGED');
    if (!request.exportOptions && exportOptions.includeThinking) fail('EXTENSION_UPDATE_REQUIRED');
    const snapshot = { ...request.snapshot, messages: request.snapshot.messages.filter(message => exportOptions.includeThinking || message.kind !== 'thinking') };
    if (!snapshot.messages.some(message => message.kind !== 'thinking')) fail('EMPTY_GRAPH');
    if (request.expectedRevision !== this.revision(snapshot.conversationId)) fail('REVISION_CONFLICT');
    const assetBytes = await this.assetBytes(snapshot);
    const messages = snapshot.messages.map(message => ({ ...message, ...(message.kind === 'thinking' ? { sourceKind: 'thinking' as const } : {}), parts: message.parts.map(part => part.type === 'image'
      ? { type: 'image' as const, pointer: `ai-inbox-asset:${part.sha256}`, ...(part.alt ? { alt: part.alt } : {}) } : part) }));
    const manifest = imageManifest(messages);
    if (manifest.some(asset => !assetBytes.has(asset.reference.slice('ai-inbox-asset:'.length))) || manifest.length !== assetBytes.size) fail('ASSET_MANIFEST_MISMATCH');
    const sourceHash = hash(stableJson({ exportOptions, title: snapshot.title, messages: snapshot.messages.map(message => ({ role: message.role, ...(message.kind ? { kind: message.kind } : {}),
      parts: message.parts.map(part => part.type === 'text' ? { ...part, text: normalizeBody(part.text) } : part) })) }));
    const oldTarget = this.state.conversations[snapshot.conversationId];
    const old = oldTarget ? this.state.notes[oldTarget.noteId] : undefined;
    const located = old ? await this.locate(old) : null;
    let assetModified = false;
    if (old) for (const asset of old.assets) {
      const bytes = await this.store.readBinary(asset.path);
      if (!bytes || hash(bytes) !== asset.sha256) assetModified = true;
    }
    const editors = located ? this.store.editor(located.path) : [];
    const localBody = located ? splitMarkdown(located.text).body : '';
    const editorModified = !!old && editors.some(text => {
      try { return hash(normalizeBody(splitMarkdown(text).body)) !== old.bodyHash; } catch { return true; }
    });
    let action = decideSave({ trustedTarget: !!old && !!located, localBody, baselineBodyHash: old?.bodyHash ?? '',
      previousSourceHash: old?.sourceHash ?? '', sourceHash, localAssetModified: assetModified || editorModified });
    // Any unsaved buffer difference is conservatively protected, including YAML.
    if (located && editors.some(text => normalizeBody(text) !== normalizeBody(located.text))) action = 'forked';
    let noteId = old?.noteId ?? randomUUID(); let path = located?.path ?? '';
    let before = located?.text ?? null;
    if (action === 'created' || action === 'forked') {
      noteId = randomUUID(); before = null;
      const date = new Date(snapshot.capturedAt);
      let counter = 1;
      do {
        const name = action === 'created' && counter === 1 ? `${safeTitle(snapshot.title)}.md` : timestampName(snapshot.title, date, counter);
        path = `${this.folder}/${name}`; counter++;
      } while (await this.store.read(path) !== null);
    }
    const assetPaths = await this.assets(snapshot, path, assetBytes, action === 'updated' || action === 'unchanged' ? old : undefined);
    const body = renderConversation({ title: snapshot.title, sourceUrl: snapshot.sourceUrl, messages, assets: assetPaths, options: exportOptions });
    const prefix = before !== null ? splitMarkdown(before).prefix :
      `---\nsource: chatgpt\nconversation_id: ${JSON.stringify(snapshot.conversationId)}\nsource_url: ${JSON.stringify(snapshot.sourceUrl)}\nai_inbox_id: ${JSON.stringify(noteId)}\ncaptured_at: ${JSON.stringify(snapshot.capturedAt)}\n---\n\n`;
    const after = action === 'unchanged' ? before! : prefix + body;
    const note: Note = { noteId, conversationId: snapshot.conversationId, path, sourceHash,
      bodyHash: hash(normalizeBody(splitMarkdown(after).body)), assets: [...assetPaths].map(([key, assetPath]) => ({ sha256: key.slice('ai-inbox-asset:'.length), path: assetPath })) };
    const receipt: SaveReceipt = { requestId: request.requestId, action, noteId, path,
      revision: request.expectedRevision + 1, messages: messages.length, images: assetPaths.size };
    const pending = { requestId: request.requestId, payloadHash, before, after, note, receipt };
    await this.persist({ ...this.state, assets: { ...this.state.assets, ...Object.fromEntries(note.assets.map(asset => [asset.sha256, asset.path])) }, pending });
    try {
      if (action === 'created' || action === 'forked') await this.store.create(path, after);
      else if (action === 'updated') {
        await this.store.replace(path, before!, after, () => this.store.editor(path).every(text => normalizeBody(text) === normalizeBody(before!)));
      } else if (await this.store.read(path) !== before || this.store.editor(path).some(text => normalizeBody(text) !== normalizeBody(before!))) fail('REPLAN_REQUIRED');
    } catch (error) {
      // Store adapters may certify rejection before any write. Other failures
      // retain the journal because the outcome might already be on disk.
      if (error instanceof ProbeError && ['REPLAN_REQUIRED', 'PATH_EXISTS'].includes(error.code)) {
        await this.persist({ ...this.state, pending: null });
      }
      throw error;
    }
    if (await this.store.read(path) !== after) fail('WRITE_UNVERIFIED');
    await this.persist(this.completed(this.state, pending));
    for (const asset of snapshot.assets) this.uploads.delete(asset.sha256);
    return receipt;
  }
}
