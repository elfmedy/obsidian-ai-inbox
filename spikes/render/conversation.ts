import { DEFAULT_EXPORT_OPTIONS, type ExportOptionsData } from '../shared/export-options';
import type { GraphMessage } from '../capture/graph';
import { ProbeError } from '../shared/errors';
import { inspectMarkdown, localImage, localizeMarkdown } from './markdown';
import { expandCitations } from './citations';

/** A source-wide list including Markdown images outside the currently visible
 * DOM. Repeated references download once while retaining all message owners. */
export function imageManifest(messages: readonly GraphMessage[]) {
  const manifest = new Map<string, Set<string>>();
  for (const message of messages) {
    for (const part of message.parts) {
      const references = part.type === 'image' ? [part.pointer] : inspectMarkdown(expandCitations(part.text, message.contentReferences)).images.map(image => image.reference);
      for (const reference of references) {
        if (!manifest.has(reference)) manifest.set(reference, new Set());
        manifest.get(reference)!.add(message.id);
      }
    }
  }
  return [...manifest].map(([reference, owners]) => ({ reference, messageIds: [...owners] }));
}

/** Deterministic body renderer only: no writes, timestamps, source credentials,
 * or mutable properties here. The eventual writer owns frontmatter and policy. */
export function renderConversation(input: { title: string; sourceUrl: string; messages: readonly GraphMessage[];
  assets: ReadonlyMap<string, string>; options?: ExportOptionsData }): string {
  const source = new URL(input.sourceUrl);
  if (source.origin !== 'https://chatgpt.com' || !/^\/c\/[A-Za-z0-9-]+\/?$/.test(source.pathname) ||
      source.search || source.hash || source.username || source.password) throw new ProbeError('SOURCE_URL_INVALID', 'Expected a current ChatGPT conversation URL');
  if (!input.messages.length) throw new ProbeError('EMPTY_GRAPH', 'No messages to render');
  const title = input.title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()#+.!<>|]/g, '\\$&');
  const options = input.options ?? DEFAULT_EXPORT_OPTIONS;
  const zh = options.language === 'zh';
  const sections = input.messages.filter(message => options.includeThinking || message.sourceKind !== 'thinking').map(message => {
    const content = message.parts.map(part => {
      if (part.type === 'text') return localizeMarkdown(expandCitations(part.text, message.contentReferences), input.assets);
      const path = input.assets.get(part.pointer);
      if (!path) throw new ProbeError('IMAGE_NOT_LOCAL', 'Required image is missing');
      return localImage(path, part.alt);
    }).join('\n\n');
    if (message.sourceKind === 'thinking') return `> [!note]- ${zh ? '思考' : 'Thinking'}\n${content.split('\n').map(line => `> ${line}`).join('\n')}`;
    return `## ${message.role === 'user' ? (zh ? '用户' : 'User') : 'ChatGPT'}\n\n${content}`;
  });
  return `${options.includeTitle ? `# ${title}\n\n` : ''}${zh ? '来源' : 'Source'}: [ChatGPT](${source.href})\n\n${sections.join('\n\n---\n\n')}\n`;
}
