import { ProbeError } from '../shared/errors';

/** Preserve SVG islands, including ChatGPT template syntax, as inert source.
 * This scanner only finds the boundary: it does not parse/evaluate templates or
 * render SVG. Quotes, comments and brace expressions cannot close the island. */
export function svgSourceEnd(input: string, start: number): number {
  let nesting = 0; let tag = false; let closing = false; let svg = false;
  let quote = ''; let braces = 0;
  for (let cursor = start; cursor < input.length; cursor++) {
    const char = input[cursor]!;
    if (quote) {
      if (char === '\\') cursor++;
      else if (char === quote) quote = '';
      continue;
    }
    if (input.startsWith('<!--', cursor)) {
      const end = input.indexOf('-->', cursor + 4);
      if (end < 0) break;
      cursor = end + 2; continue;
    }
    if (braces && input.startsWith('/*', cursor)) {
      const end = input.indexOf('*/', cursor + 2);
      if (end < 0) break;
      cursor = end + 1; continue;
    }
    if (braces && input.startsWith('//', cursor)) {
      const end = input.indexOf('\n', cursor + 2);
      if (end < 0) break;
      cursor = end; continue;
    }
    if ((tag || braces) && (char === '"' || char === "'" || char === '`')) { quote = char; continue; }
    if (char === '{') { braces++; continue; }
    if (braces) { if (char === '}') braces--; continue; }
    if (!tag && char === '<') {
      const head = /^<(\/)?([A-Za-z][\w:-]*)(?=[\s/>])/.exec(input.slice(cursor));
      if (!head) continue;
      tag = true; closing = !!head[1]; svg = head[2] === 'svg';
      cursor += head[0].length - 1; continue;
    }
    if (tag && char === '>') {
      if (svg) {
        if (closing) nesting--;
        else if (input[cursor - 1] !== '/') nesting++;
        if (!nesting) return cursor + 1;
        if (nesting > 32) break;
      }
      tag = false;
    }
  }
  throw new ProbeError('HTML_CONTENT_REQUIRES_ADAPTER', 'Unclosed or unsupported SVG source');
}

export function fencedSvgSource(source: string, newline: string): string {
  // A source containing Markdown fences must never escape the generated block.
  let length = 3;
  for (const match of source.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = '`'.repeat(length);
  return `SVG source (not rendered)${newline}${newline}${fence}text${newline}${source}${newline}${fence}`;
}
