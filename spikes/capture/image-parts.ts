// Adapted from Pionxzh src/api.ts and OwlCt Tampermonkey.js image extraction.
// Pinned revisions and MIT notices: THIRD_PARTY_NOTICES.md.
import { isRecord, ProbeError } from '../shared/errors';

export interface ImagePart { type: 'image'; pointer: string; alt?: string; }
function pointer(value: unknown, alt?: unknown): ImagePart {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\r\n]/.test(value)) {
    throw new ProbeError('IMAGE_REFERENCE_INVALID', 'Image reference needs an adapter');
  }
  if (alt !== undefined && alt !== null && (typeof alt !== 'string' || alt.length > 16384)) throw new ProbeError('IMAGE_ALT_INVALID', 'Invalid image description');
  return { type: 'image', pointer: value, ...(typeof alt === 'string' && alt ? { alt } : {}) };
}

export function parseImagePart(value: unknown): ImagePart | null {
  if (!isRecord(value)) return null;
  const kind = value.content_type ?? value.type;
  if (kind !== 'image_asset_pointer' && kind !== 'image_asset' && !isRecord(value.image_asset)) return null;
  const asset = isRecord(value.image_asset) ? value.image_asset : value;
  return pointer(asset.asset_pointer ?? asset.file_id ?? asset.id ?? asset.download_url ?? asset.url, asset.alt);
}

// Adapted from OwlCt inspectFileAttachment: both current flat attachments and
// the nested `file` envelope occur upstream. Keep only the fields we need.
function attachmentField(attachment: Record<string, unknown>, keys: string[]): string | undefined {
  const nested = isRecord(attachment.file) ? attachment.file : {};
  for (const record of [attachment, nested]) for (const key of keys) {
    const value = record[key]; if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
function attachmentImage(input: unknown): ImagePart | null {
  if (!isRecord(input)) return null;
  const direct = parseImagePart(input) ?? parseImagePart(input.file); if (direct) return direct;
  const kind = attachmentField(input, ['mime_type', 'content_type', 'type']);
  if (!kind?.toLowerCase().startsWith('image/')) return null;
  return pointer(attachmentField(input, ['asset_pointer', 'file_id', 'id', 'download_url', 'url']), attachmentField(input, ['alt']));
}
export function attachmentDescriptions(message: Record<string, unknown>, knownImages: readonly string[] = []): string[] {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  if (!Array.isArray(metadata.attachments)) return [];
  if (metadata.attachments.length > 1000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many attachments');
  const result: string[] = [];
  for (const attachment of metadata.attachments) {
    if (attachmentImage(attachment)) continue;
    if (!isRecord(attachment)) throw new ProbeError('ATTACHMENT_INVALID', 'Unknown attachment');
    const name = attachmentField(attachment, ['name', 'file_name', 'filename', 'title', 'display_name']);
    const id = attachmentField(attachment, ['file_id', 'id', 'asset_pointer']);
    if (id && knownImages.some(image => image.replace(/^sediment:\/\//, '') === id.replace(/^sediment:\/\//, ''))) continue;
    if (name && name.length > 4096) throw new ProbeError('ATTACHMENT_INVALID', 'Attachment name too long');
    const identifier = typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id) ? `；引用：\`${id}\`` : '';
    if (!name && !identifier) throw new ProbeError('ATTACHMENT_INVALID', 'Attachment identity unavailable');
    const escaped = (name ?? '名称未提供').replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]()#+.!<>|]/g, '\\$&');
    result.push(`附件（未下载）：${escaped}${identifier}`);
  }
  return result;
}

export function metadataImages(message: Record<string, unknown>): ImagePart[] {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const result: ImagePart[] = [];
  if (Array.isArray(metadata.attachments)) {
    for (const attachment of metadata.attachments) {
      const image = attachmentImage(attachment);
      if (image) result.push(image);
    }
  }
  if (isRecord(metadata.aggregate_result) && Array.isArray(metadata.aggregate_result.messages)) {
    for (const entry of metadata.aggregate_result.messages) {
      if (isRecord(entry) && entry.message_type === 'image') result.push(pointer(entry.image_url));
    }
  }
  return result;
}

export function toolImages(message: Record<string, unknown>): ImagePart[] {
  const content = isRecord(message.content) ? message.content : {};
  const root = parseImagePart(content);
  const images = root ? [root] : [];
  if (Array.isArray(content.parts)) {
    for (const part of content.parts) {
      if (typeof part === 'string') continue;
      const image = parseImagePart(part);
      if (!image) throw new ProbeError('UNSUPPORTED_TOOL_CONTENT', 'Unknown tool content part');
      images.push(image);
    }
  }
  images.push(...metadataImages(message));
  return images;
}
