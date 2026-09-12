import { fromMarkdown } from 'mdast-util-from-markdown';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from 'micromark-extension-math';
import { isRecord, ProbeError } from '../shared/errors';
import { transformContentReferences } from './citations-upstream';

export interface ContentReferenceSource { title?: string; url?: string; attribution?: string; supporting_websites?: ContentReferenceSource[]; }
export interface ContentReference extends ContentReferenceSource {
  type: string; matched_text?: string; alt?: string; items?: ContentReferenceSource[];
  sources?: ContentReferenceSource[]; fallback_items?: ContentReferenceSource[]; safe_urls?: string[];
}
function source(input: unknown, depth = 0): ContentReferenceSource {
  if (!isRecord(input) || depth > 2) throw new ProbeError('CITATION_INVALID', 'Invalid source shape');
  const result: ContentReferenceSource = {};
  for (const key of ['title', 'url', 'attribution'] as const) {
    const value = input[key];
    if (typeof value === 'string') {
      if (value.length > 16384) throw new ProbeError('LIMIT_EXCEEDED', 'Source field too long');
      result[key] = value;
    }
  }
  if (result.url) {
    let url: URL;
    try { url = new URL(result.url); } catch { throw new ProbeError('CITATION_URL_INVALID', 'Citation address unsupported'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ProbeError('CITATION_URL_INVALID', 'Citation address unsupported');
  }
  if (Array.isArray(input.supporting_websites)) {
    if (input.supporting_websites.length > 100) throw new ProbeError('LIMIT_EXCEEDED', 'Too many supporting sources');
    result.supporting_websites = input.supporting_websites.map(item => source(item, depth + 1));
  }
  return result;
}
export function readReferences(metadata: unknown): ContentReference[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.content_references)) return [];
  if (metadata.content_references.length > 1000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many citations');
  return metadata.content_references.map((value: unknown) => {
    if (!isRecord(value) || typeof value.type !== 'string') throw new ProbeError('CITATION_INVALID', 'Reference type missing');
    const ref: ContentReference = { ...source(value), type: value.type };
    for (const key of ['matched_text', 'alt'] as const) if (typeof value[key] === 'string' && value[key].length <= 16384) ref[key] = value[key];
    for (const key of ['items', 'sources', 'fallback_items'] as const) {
      if (Array.isArray(value[key])) {
        if (value[key].length > 1000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many sources');
        ref[key] = value[key].map(item => source(item));
      }
    }
    if (Array.isArray(value.safe_urls)) {
      if (value.safe_urls.length > 1000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many source URLs');
      ref.safe_urls = value.safe_urls.map((url: unknown) => source({ url }).url).filter((url): url is string => !!url);
    }
    return ref;
  });
}

export function expandCitations(input: string, references: ContentReference[] = [], includeSources = true): string {
  if (input.length > 2 * 1024 * 1024) throw new ProbeError('LIMIT_EXCEEDED', 'Markdown block too large');
  // Exclude code and TeX: quoted marker examples must not be rewritten.
  const tree = fromMarkdown(input, { extensions: [math()], mdastExtensions: [mathFromMarkdown()] });
  const protectedRanges: Array<[number, number]> = [];
  const queue: Array<{ type: string; children?: unknown; position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined }> = [tree];
  while (queue.length) {
    const node = queue.pop()!;
    if (['code', 'inlineCode', 'math', 'inlineMath'].includes(node.type)) {
      const start = node.position?.start.offset; const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
    } else if (Array.isArray(node.children)) queue.push(...node.children as typeof queue);
  }
  protectedRanges.sort((a, b) => a[0] - b[0]);
  let output = ''; let cursor = 0;
  const convert = (text: string) => retainUnresolvedMarkers(transformContentReferences(text, { content_references: references }, { includeSourceList: false }));
  for (const [start, end] of protectedRanges) { output += convert(input.slice(cursor, start)) + input.slice(start, end); cursor = end; }
  output += convert(input.slice(cursor));
  if (includeSources) {
    const footnotes = transformContentReferences('', { content_references: references.filter(ref => ref.type === 'sources_footnote') });
    if (footnotes) output += `\n\n${retainUnresolvedMarkers(footnotes)}`;
  }
  return output;
}

/** Upstream exporters remove unresolved citation markers after expansion.
 * Preserve their payload instead, with an explicit label and inert code span.
 * Only called outside the original code/TeX ranges; never invent source URLs.
 */
function retainUnresolvedMarkers(input: string): string {
  return input.replace(/\uE200([^\uE200\uE201]*)\uE201|[\uE200-\uE204]/gu, (raw: string, payload: string | undefined) => {
    if (raw.length > 16384) throw new ProbeError('LIMIT_EXCEEDED', 'Citation marker too large');
    const label = payload?.startsWith('cite\uE202') ? '引用未解析' : 'ChatGPT 标记未解析';
    // Literal Unicode escapes retain the exact original marker, including its
    // boundaries, while remaining readable in Obsidian and plain Markdown.
    const literal = raw.replace(/[\uE200-\uE204]/gu, character => `\\u${character.charCodeAt(0).toString(16).toUpperCase()}`)
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    const longest = Math.max(0, ...Array.from(literal.matchAll(/`+/g), match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    return `〔${label}：${fence} ${literal} ${fence}〕`;
  });
}
