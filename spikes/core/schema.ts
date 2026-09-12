import { z } from 'zod';
import { ProbeError } from '../shared/errors';

export const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const Id = z.string().regex(/^[A-Za-z0-9-]{1,128}$/);
export const Asset = z.strictObject({ sha256: Digest, mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']),
  byteLength: z.number().int().min(12).max(25 * 1024 * 1024) });
export const Snapshot = z.strictObject({ schemaVersion: z.literal(1), conversationId: Id,
  sourceUrl: z.string().max(512), title: z.string().max(512), capturedAt: z.iso.datetime(),
  messages: z.array(z.strictObject({ id: Id, role: z.enum(['user', 'assistant']), parts: z.array(z.union([
    z.strictObject({ type: z.literal('text'), text: z.string().max(2 * 1024 * 1024) }),
    z.strictObject({ type: z.literal('image'), sha256: Digest, alt: z.string().max(16384).optional() }),
  ])).min(1).max(1000) })).min(1).max(20000), assets: z.array(Asset).max(1000),
}).superRefine((snapshot, context) => {
  if (snapshot.sourceUrl !== `https://chatgpt.com/c/${snapshot.conversationId}`) context.addIssue({ code: 'custom', message: 'Conversation identity mismatch' });
  if (new Set(snapshot.messages.map(message => message.id)).size !== snapshot.messages.length) context.addIssue({ code: 'custom', message: 'Duplicate messages' });
  if (new Set(snapshot.assets.map(asset => asset.sha256)).size !== snapshot.assets.length) context.addIssue({ code: 'custom', message: 'Duplicate assets' });
  if (snapshot.assets.reduce((sum, asset) => sum + asset.byteLength, 0) > 250 * 1024 * 1024) context.addIssue({ code: 'custom', message: 'Asset total exceeds limit' });
});
export type SnapshotData = z.infer<typeof Snapshot>;
export const SaveRequest = z.strictObject({ requestId: z.uuid(), expectedRevision: z.number().int().nonnegative(), snapshot: Snapshot });
export type SaveRequestData = z.infer<typeof SaveRequest>;
export function parseSaveRequest(input: unknown): SaveRequestData {
  const result = SaveRequest.safeParse(input);
  if (!result.success) throw new ProbeError('SNAPSHOT_INVALID', 'Snapshot validation failed');
  return result.data;
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
