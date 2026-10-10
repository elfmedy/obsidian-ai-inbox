import { fromMarkdown } from 'mdast-util-from-markdown';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from 'micromark-extension-math';
import { ProbeError } from '../shared/errors';
import { formatCitationSource } from './citations-upstream';
import { fencedSvgSource, svgSourceEnd } from './svg-source';

const containers = new Set(['grid', 'grid-item', 'box', 'row']);
const attributes = new Set(['columns', 'gap', 'border', 'radius', 'padding', 'background', 'align', 'justify', 'color', 'size', 'weight', 'name',
  'textAlign', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']);
const arrows: Readonly<Record<string, string>> = { 'arrow-down': '↓', 'arrow-up': '↑', 'arrow-left': '←', 'arrow-right': '→' };
const unsupported = () => new ProbeError('HTML_CONTENT_REQUIRES_ADAPTER', 'HTML needs a verified content adapter');

interface Tag { name: string; closing: boolean; selfClosing: boolean; end: number; values: Map<string, string>; }

/** Read a deliberately small, inert JSX-like vocabulary. Attribute expressions
 * are balanced strings, never JavaScript; unknown/behavioural attributes fail. */
function readTag(input: string, start: number): Tag | undefined {
  const head = /^<(\/)?(grid-item|grid|box|row|text|caption|icon|Link)(?=[\s/>])/.exec(input.slice(start));
  if (!head) return undefined;
  let cursor = start + head[0].length;
  const values = new Map<string, string>();
  while (cursor - start <= 4096) {
    const whitespace = /^\s*/.exec(input.slice(cursor))![0]; cursor += whitespace.length;
    if (input[cursor] === '>' || input.slice(cursor, cursor + 2) === '/>') {
      const selfClosing = input[cursor] === '/';
      if (head[1] && (values.size || selfClosing)) throw unsupported();
      return { name: head[2]!, closing: !!head[1], selfClosing, end: cursor + (selfClosing ? 2 : 1), values };
    }
    if (!whitespace || head[1]) throw unsupported();
    const key = /^[a-zA-Z][a-zA-Z-]*/.exec(input.slice(cursor))?.[0];
    if (!key || !(head[2] === 'Link' ? ['url', 'title'].includes(key) : attributes.has(key)) || values.has(key)) throw unsupported();
    cursor += key.length;
    const afterKey = cursor + /^\s*/.exec(input.slice(cursor))![0].length;
    let value = '';
    if (input[afterKey] === '=') {
      cursor = afterKey + 1; cursor += /^\s*/.exec(input.slice(cursor))![0].length;
      const begin = cursor; const first = input[cursor];
      if (first !== '"' && first !== "'" && first !== '{') throw unsupported();
      let quote = first === '{' ? '' : first; let braces = first === '{' ? 1 : 0;
      cursor++;
      for (; cursor < input.length && cursor - start <= 4096; cursor++) {
        const char = input[cursor]!;
        if (quote) {
          if (char === '\\') { cursor++; continue; }
          if (char === quote) { quote = ''; if (!braces) { cursor++; break; } }
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '{') braces++;
        else if (char === '}' && --braces === 0) { cursor++; break; }
      }
      if (quote || braces || cursor - start > 4096) throw unsupported();
      value = input.slice(begin, cursor);
    }
    values.set(key, value);
  }
  throw unsupported();
}

/** HTML is disabled only in this shadow parse so it cannot swallow Markdown
 * fences. The actual export still rejects unadapted HTML in inspectMarkdown. */
function literalRanges(input: string): Array<[number, number]> {
  const tree = fromMarkdown(input, { extensions: [{ disable: { null: ['htmlFlow', 'htmlText'] } }, math()], mdastExtensions: [mathFromMarkdown()] });
  const ranges: Array<[number, number]> = [];
  const queue = [tree as { type: string; children?: typeof tree.children; position?: typeof tree.position }];
  while (queue.length) {
    const node = queue.pop()!;
    if (['code', 'inlineCode', 'math', 'inlineMath', 'definition'].includes(node.type)) {
      const start = node.position?.start.offset; const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) ranges.push([start, end]);
    } else if (node.children) queue.push(...node.children);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

function dedent(input: string): string {
  const lines = input.split('\n');
  const nonblank = lines.filter(line => line.trim());
  const indentation = nonblank.reduce((minimum, line) => Math.min(minimum, /^ */.exec(line)![0].length), Infinity);
  return lines.map(line => line.slice(Math.min(indentation, /^ */.exec(line)![0].length))).join('\n');
}

/** Find a standalone container's end, respecting fences even before its layout
 * indentation has been removed. Do not use an HTML parser on Markdown bodies. */
function containerEnd(input: string, start: number, name: string): { start: number; end: number } {
  const stack = [name]; let fence = ''; let fenceLength = 0; let inMath = false;
  const lines = /[^\n]*(?:\n|$)/g; lines.lastIndex = start;
  for (let match = lines.exec(input); match && match[0]; match = lines.exec(input)) {
    const line = match[0]; const trimmed = line.trim();
    if (!trimmed) continue;
    const delimiter = /^(?:`{3,}|~{3,})/.exec(trimmed)?.[0];
    if (fence) {
      if (delimiter?.[0] === fence && delimiter.length >= fenceLength && trimmed === delimiter) fence = '';
      continue;
    }
    if (delimiter) { fence = delimiter[0]!; fenceLength = delimiter.length; continue; }
    if (/^\${2,}\s*$/.test(trimmed)) { inMath = !inMath; continue; }
    if (inMath) continue;
    const offset = match.index + line.indexOf(trimmed);
    if (/^<svg(?=[\s/>])/.test(trimmed)) {
      lines.lastIndex = svgSourceEnd(input, offset); continue;
    }
    const tag = readTag(input, offset);
    if (!tag || !containers.has(tag.name) || input.slice(tag.end, match.index + line.length).trim()) continue;
    if (tag.closing) {
      if (stack.pop() !== tag.name) throw unsupported();
      if (!stack.length) return { start: match.index, end: tag.end };
    } else {
      if (tag.selfClosing || stack.length >= 32) throw unsupported();
      stack.push(tag.name);
    }
  }
  throw unsupported();
}

/** Flatten only known ChatGPT presentation components. Ordinary Markdown is
 * copied verbatim; component bodies lose only their common layout indentation.
 * Unknown HTML is left for the existing fail-closed content/asset checks. */
export function adaptRichLayout(input: string, depth = 0): string {
  if (input.length > 2 * 1024 * 1024 || depth > 32) throw new ProbeError('LIMIT_EXCEEDED', 'Rich content too large or deeply nested');
  if (!/<\/?(?:grid|grid-item|box|row|text|caption|icon|Link|svg)(?=[\s/>])/.test(input)) return input;
  const protectedRanges = literalRanges(input);
  const pattern = /<\/?(?:grid-item|grid|box|row|text|caption|icon|Link|svg)(?=[\s/>])/g;
  let output = ''; let cursor = 0; let rangeIndex = 0;
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    // Escaped examples are ordinary Markdown text, not presentation markup.
    let backslashes = 0;
    for (let index = match.index - 1; index >= 0 && input[index] === '\\'; index--) backslashes++;
    if (backslashes % 2) continue;
    while (protectedRanges[rangeIndex] && protectedRanges[rangeIndex]![1] <= match.index) rangeIndex++;
    const range = protectedRanges[rangeIndex];
    if (range && range[0] <= match.index) { pattern.lastIndex = range[1]; continue; }
    if (match[0] === '<svg') {
      const end = svgSourceEnd(input, match.index);
      const newline = input.includes('\r\n') ? '\r\n' : '\n';
      output += input.slice(cursor, match.index) + newline + newline + fencedSvgSource(input.slice(match.index, end), newline) + newline + newline;
      cursor = end; pattern.lastIndex = end; continue;
    }
    const tag = readTag(input, match.index)!;
    if (!tag) throw unsupported();
    if (tag.closing) throw unsupported();
    let replacement: string; let end = tag.end;
    if (containers.has(tag.name)) {
      const lineStart = input.lastIndexOf('\n', match.index - 1) + 1;
      const lineEnd = input.indexOf('\n', tag.end);
      if (tag.selfClosing || !/^ {0,3}$/.test(input.slice(lineStart, match.index)) || lineEnd < 0 || input.slice(tag.end, lineEnd).trim()) throw unsupported();
      const closing = containerEnd(input, lineEnd + 1, tag.name);
      const body = dedent(input.slice(lineEnd + 1, closing.start));
      const content = adaptRichLayout(body, depth + 1).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
      const prefix = output + input.slice(cursor, match.index); const suffix = input.slice(closing.end);
      const before = prefix.match(/(?:\r?\n[ \t]*)*$/)![0].split('\n').length - 1;
      const after = suffix.match(/^(?:[ \t]*\r?\n)*/)![0].split('\n').length - 1;
      const newline = input.includes('\r\n') ? '\r\n' : '\n';
      replacement = (prefix.trim() ? newline.repeat(Math.max(0, 2 - before)) : '') + content +
        (suffix.trim() ? newline.repeat(Math.max(0, 2 - after)) : ''); end = closing.end;
    } else if (tag.name === 'text' || tag.name === 'caption') {
      if (tag.selfClosing) throw unsupported();
      const closingTag = `</${tag.name}>`;
      const close = input.indexOf(closingTag, tag.end);
      if (close < 0 || input.slice(tag.end, close).includes('\n')) throw unsupported();
      replacement = adaptRichLayout(input.slice(tag.end, close), depth + 1); end = close + closingTag.length;
    } else if (tag.name === 'Link') {
      if (!tag.selfClosing) throw unsupported();
      const url = quotedValue(tag.values.get('url')); const title = tag.values.has('title') ? quotedValue(tag.values.get('title')) : url;
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw unsupported(); }
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || url.includes('\\') ||
        Array.from(url).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw unsupported();
      // Titles are literal labels; angle brackets/backticks must not become
      // markup when the normalized Markdown is inspected a second time.
      const label = title.replace(/[<>`]/g, char => ({ '<': '&lt;', '>': '&gt;', '`': '&#96;' })[char]!);
      replacement = formatCitationSource({ url, title: label }, 'markdown');
    } else {
      const value = tag.values.get('name');
      const iconName = value?.match(/^["']([a-z-]+)["']$/)?.[1];
      if (!tag.selfClosing || !iconName || !arrows[iconName]) throw unsupported();
      replacement = arrows[iconName]!;
    }
    output += input.slice(cursor, match.index) + replacement; cursor = end; pattern.lastIndex = end;
  }
  return output + input.slice(cursor);
}

function quotedValue(value: string | undefined): string {
  if (!value || !/^(?:"[^"\r\n]*"|'[^'\r\n]*')$/.test(value)) throw unsupported();
  return value.slice(1, -1).replace(/&(?:amp|quot|apos|lt|gt);/g, entity =>
    ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity]!);
}
