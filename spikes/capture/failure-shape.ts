import { isRecord } from '../shared/errors';

// Only predefined field names plus types/counts. No source values, dynamic
// object keys, message IDs, names, URLs, text, or credentials enter the report.
function shape(input: unknown, keys: readonly string[]) {
  if (!isRecord(input)) return { type: input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input };
  const fields: Record<string, { type: string; count?: number }> = {};
  for (const key of keys) {
    const value = input[key]; if (value === undefined) continue;
    fields[key] = Array.isArray(value) ? { type: 'array', count: value.length } : value === null ? { type: 'null' }
      : isRecord(value) ? { type: 'object', count: Object.keys(value).length } : { type: typeof value };
  }
  return { type: 'object', fields, unknownFields: Object.keys(input).filter(key => !keys.includes(key)).length };
}
const attachmentKeys = ['file', 'name', 'file_name', 'filename', 'title', 'display_name', 'id', 'file_id', 'asset_pointer', 'mime_type', 'content_type', 'type', 'image_asset', 'download_url', 'url'];
const referenceKeys = ['type', 'matched_text', 'alt', 'items', 'sources', 'fallback_items', 'safe_urls', 'url', 'title', 'attribution', 'supporting_websites'];
export function summarizeFailure(input: unknown) {
  const message = isRecord(input) ? input : {}; const metadata = isRecord(message.metadata) ? message.metadata : {};
  const attachments: unknown[] = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  const references: unknown[] = Array.isArray(metadata.content_references) ? metadata.content_references : [];
  return { message: shape(message, ['id', 'author', 'channel', 'status', 'content', 'metadata', 'recipient']),
    content: shape(message.content, ['content_type', 'parts', 'text']),
    attachments: { count: attachments.length, samples: attachments.slice(0, 3).map(item => ({
      root: shape(item, attachmentKeys), nestedFile: shape(isRecord(item) ? item.file : undefined, attachmentKeys) })) },
    references: { count: references.length, samples: references.slice(0, 3).map(item => shape(item, referenceKeys)) } };
}
