/** Exclude only a UI image source observed on the test page. Do not infer that
 * small dimensions or a missing alt label mean an image is unimportant. */
export function isCitationFavicon(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname === '/s2/favicons';
  } catch { return false; }
}
