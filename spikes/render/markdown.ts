import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from 'micromark-extension-math';
import { ProbeError } from '../shared/errors';

interface Node {
  type: string; children?: Node[] | undefined; url?: string | undefined; identifier?: string | undefined; alt?: string | null | undefined;
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } } | undefined;
}
interface Edit { start: number; end: number; value: string; }
function nodes(node: Node): Node[] { return [node, ...(node.children?.flatMap(nodes) ?? [])]; }

export function localImage(path: string, alt = ''): string {
  if (!path || path.length > 4096 || /[\\:<>"|?*\r\n]/.test(path) || path.startsWith('/') ||
      path.split('/').some(segment => !segment || ['.', '..'].includes(segment) || /[ .]$/.test(segment))) {
    throw new ProbeError('ASSET_PATH_INVALID', 'Expected a safe relative Vault image path');
  }
  // Obsidian resolves /-prefixed Markdown links from the Vault root. This
  // preserves a real alt attribute and remains stable when a note is moved.
  if (alt || /[[\]#%]/.test(path)) return `![${alt.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&')}](</${path.split('/').map(encodeURIComponent).join('/')}>)`;
  return `![[${path}]]`;
}

/** Use upstream CommonMark/GFM/TeX parsers to locate edits, keeping all other
 * source bytes intact: do not serialize the tree and reformat the conversation. */
export function inspectMarkdown(input: string) {
  if (input.length > 2 * 1024 * 1024) throw new ProbeError('LIMIT_EXCEEDED', 'Markdown block too large');
  const all = nodes(fromMarkdown(input, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] }));
  const definitions = new Map<string, string>();
  for (const node of all) {
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  }
  const images: Array<{ reference: string; start: number; end: number; alt: string }> = [];
  const literalEdits: Edit[] = [];
  for (const node of all) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (node.type === 'html') throw new ProbeError('HTML_CONTENT_REQUIRES_ADAPTER', 'HTML needs a verified content adapter');
    if (node.type === 'image' || node.type === 'imageReference') {
      const reference = node.url ?? (node.identifier ? definitions.get(node.identifier) : undefined);
      if (!reference) throw new ProbeError('IMAGE_REFERENCE_INVALID', 'Image definition is missing');
      images.push({ reference, start, end, alt: node.alt ?? '' });
    }
    if (node.type === 'text') {
      const raw = input.slice(start, end);
      if (/[\uE200-\uE204]/u.test(raw)) throw new ProbeError('CITATION_REQUIRES_ADAPTER', 'Citation metadata is required');
      // Only ordinary text spans, never code, TeX, image destinations or HTML.
      const escaped = raw.replace(/(\\*)\[\[/g, (match: string, backslashes: string) =>
        backslashes.length % 2 === 0 ? `${backslashes}\\[\\[` : match);
      if (escaped !== raw) literalEdits.push({ start, end, value: escaped });
    }
  }
  return { images, literalEdits };
}

/** Canonicalize image destinations before durable browser storage. Reference
 * definitions shared with ordinary links need a dedicated adapter. */
export function canonicalizeImages(input: string, digests: ReadonlyMap<string, string>): string {
  const parsed = inspectMarkdown(input);
  const all = nodes(fromMarkdown(input, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] }));
  const edits: Edit[] = parsed.images.map(image => {
    const digest = digests.get(image.reference);
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new ProbeError('IMAGE_NOT_LOCAL', 'Image is not downloaded');
    return { start: image.start, end: image.end, value: `![${image.alt.replace(/[\r\n]+/g, ' ').replace(/[\\[\]]/g, '\\$&')}](ai-inbox-asset:${digest})` };
  });
  const used = new Set(all.filter(node => node.type === 'imageReference').map(node => node.identifier));
  for (const node of all) {
    if (node.type === 'definition' && used.has(node.identifier)) {
      if (all.some(other => other.type === 'linkReference' && other.identifier === node.identifier)) throw new ProbeError('SHARED_IMAGE_DEFINITION', 'Image definition is also a link');
      const start = node.position?.start.offset; const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) edits.push({ start, end, value: '' });
    }
  }
  let output = input;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return output;
}

export function localizeMarkdown(input: string, assets: ReadonlyMap<string, string>): string {
  const parsed = inspectMarkdown(input);
  const edits: Edit[] = [...parsed.literalEdits, ...parsed.images.map(image => {
    const path = assets.get(image.reference);
    if (!path) throw new ProbeError('IMAGE_NOT_LOCAL', 'Required image has no verified local asset');
    return { start: image.start, end: image.end, value: localImage(path, image.alt) };
  })];
  edits.sort((left, right) => right.start - left.start);
  let output = input;
  let boundary = input.length;
  for (const edit of edits) {
    if (edit.end > boundary) throw new ProbeError('MARKDOWN_EDIT_OVERLAP', 'Markdown conversion overlapped');
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
    boundary = edit.start;
  }
  return output;
}
