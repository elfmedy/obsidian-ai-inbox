import { readBounded } from '../assets/inspect';
import { ProbeError } from '../shared/errors';

/** A read of the exact current document with existing same-origin credentials.
 * No guessed private endpoints, script execution, or navigation of the tab. */
export async function fetchCurrentDocument(pageUrl: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = new URL(pageUrl);
  if (url.origin !== 'https://chatgpt.com' || !/^\/c\/[a-zA-Z0-9-]+\/?$/.test(url.pathname) || url.username || url.password) {
    throw new ProbeError('DOCUMENT_URL_INVALID', 'Expected current conversation document');
  }
  const response = await fetcher(url.href, { credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ProbeError('DOCUMENT_HTTP_FAILED', 'Document request failed');
  if (response.url !== url.href || response.redirected) throw new ProbeError('DOCUMENT_IDENTITY_CHANGED', 'Document identity changed');
  if (!/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new ProbeError('DOCUMENT_TYPE_INVALID', 'Expected HTML document');
  }
  const bytes = await readBounded(response, 20 * 1024 * 1024);
  return new TextDecoder().decode(bytes);
}
