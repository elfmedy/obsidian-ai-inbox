import { ProbeError } from '../shared/errors';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** P0 signature inspection; not a replacement for full image decoding. */
export function detectImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif' {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length < 12) throw new ProbeError('ASSET_INVALID', 'Image header is truncated');
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (text(0, 6) === 'GIF87a' || text(0, 6) === 'GIF89a') return 'image/gif';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text(8, 12))) return 'image/avif';
  throw new ProbeError('ASSET_INVALID', 'Unsupported image header (including HTML/SVG)');
}

export async function readBounded(response: Response, limit = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  if (!response.ok) throw new ProbeError('ASSET_FETCH_FAILED', `HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > limit) {
    await response.body?.cancel();
    throw new ProbeError('LIMIT_EXCEEDED', 'Declared image size exceeds limit');
  }
  if (!response.body) throw new ProbeError('ASSET_INVALID', 'Empty response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ProbeError('LIMIT_EXCEEDED', 'Actual image size exceeds limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function allowPageImage(urlText: string, pageOrigin: string): boolean {
  try {
    const url = new URL(urlText);
    if (url.protocol === 'blob:') return url.origin === pageOrigin;
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return url.origin === pageOrigin || url.hostname.endsWith('.oaiusercontent.com') ||
      url.hostname.endsWith('.openai.com');
  } catch { return false; }
}
