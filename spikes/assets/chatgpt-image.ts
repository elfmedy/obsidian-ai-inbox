// Adapted from Pionxzh fetchImageFromPointer/fileDownloadApi and OwlCt
// resolveFileDownloadUrl. Exact upstreams and MIT licenses in THIRD_PARTY_NOTICES.md.
import { isRecord, ProbeError } from '../shared/errors';
import { allowPageImage, detectImageType, readBounded } from './inspect';

const ORIGIN = 'https://chatgpt.com';
export function imageFileId(reference: string): string | null {
  const stripped = reference.startsWith('sediment://') ? reference.slice('sediment://'.length) : reference;
  return /^(?:file[-_][A-Za-z0-9_-]+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(stripped) && stripped.length <= 256 ? stripped : null;
}

export async function downloadChatImage(reference: string, token?: string, fetcher: typeof fetch = fetch) {
  const id = imageFileId(reference);
  let url = reference;
  let route: 'direct' | 'files-download' | 'file-download' = 'direct';
  if (id) {
    const paths = [`/backend-api/files/download/${encodeURIComponent(id)}?post_id=&inline=false`,
      `/backend-api/files/${encodeURIComponent(id)}/download`];
    let resolved = false;
    for (let index = 0; index < paths.length; index++) {
      const endpoint = `${ORIGIN}${paths[index]}`;
      const response = await fetcher(endpoint, { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(15000) });
      if (response.redirected || response.url !== endpoint) throw new ProbeError('IMAGE_RESOLVER_REDIRECT', 'Image resolver redirected');
      // An alternate documented-by-upstream route is tried only for a missing
      // route, not to get around authentication/rate-limit failures.
      if ([404, 405].includes(response.status) && index === 0) { await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); throw new ProbeError('IMAGE_RESOLVER_HTTP_FAILED', 'Image reference lookup failed'); }
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel(); throw new ProbeError('IMAGE_RESOLVER_TYPE_INVALID', 'Image resolver did not return JSON');
      }
      const data: unknown = JSON.parse(new TextDecoder().decode(await readBounded(response, 1024 * 1024)));
      if (!isRecord(data) || data.status === 'error' || typeof data.download_url !== 'string') {
        throw new ProbeError('IMAGE_DOWNLOAD_URL_MISSING', 'Image download address is absent');
      }
      url = new URL(data.download_url, ORIGIN).href;
      route = index === 0 ? 'files-download' : 'file-download';
      resolved = true;
      break;
    }
    if (!resolved) throw new ProbeError('IMAGE_RESOLVER_HTTP_FAILED', 'No compatible image resolver');
  }
  if (!url.startsWith('https://') || !allowPageImage(url, ORIGIN)) {
    throw new ProbeError('IMAGE_REFERENCE_UNSUPPORTED', 'Image reference or destination needs an adapter');
  }
  // Authentication belongs only on the exact same-origin resolver above.
  // Signed CDN bytes never receive the ChatGPT bearer token.
  const response = await fetcher(url, { credentials: new URL(url).origin === ORIGIN ? 'same-origin' : 'omit',
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.redirected || response.url !== url) throw new ProbeError('IMAGE_DOWNLOAD_REDIRECT', 'Image download redirected');
  const bytes = await readBounded(response);
  const mime = detectImageType(bytes);
  const advertised = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (advertised && advertised !== 'application/octet-stream' && advertised !== mime) throw new ProbeError('IMAGE_MIME_MISMATCH', 'Image bytes differ from the declared type');
  return { bytes, mime, route };
}
