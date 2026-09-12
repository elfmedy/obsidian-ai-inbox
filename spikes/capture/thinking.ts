import { metadataImages } from './image-parts';
import { readReferences } from '../render/citations';
import { isRecord, ProbeError } from '../shared/errors';
import { recipientKind } from './message-classification';
import type { GraphMessage } from './graph';

// Shape and reasoning_title classification reviewed against Pionxzh's pinned
// api.ts / attachThinkingToNodes. Only the UI summary records are supported;
// raw analysis, model context, and tool input/output remain internal.
export function thinkingMessage(input: Record<string, unknown>, tools: ReadonlySet<string>, include: boolean): GraphMessage | null | undefined {
  if (!isRecord(input.author) || input.author.role !== 'assistant' || !isRecord(input.content)) return undefined;
  const content = input.content;
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const summaryRecord = content.content_type === 'thoughts' || content.content_type === 'reasoning_recap';
  const activity = typeof metadata.reasoning_title === 'string' && !!metadata.reasoning_title &&
    content.content_type === 'text' && input.channel !== 'final';
  if (!summaryRecord && !activity) return undefined;
  const images = activity ? metadataImages(input) : [];
  if (!include && !images.length) return null;
  if (recipientKind(input.recipient, tools) === 'tool' || (!summaryRecord && (input.channel === 'analysis' || metadata.is_visually_hidden_from_conversation === true))) return null;
  if (recipientKind(input.recipient, tools) === 'unverified') throw new ProbeError('UNVERIFIED_ASSISTANT_RECIPIENT', 'Recipient needs a verified adapter');
  if (typeof input.id !== 'string' || !input.id) throw new ProbeError('INVALID_NODE', 'Thinking ID missing');
  if (input.status !== 'finished_successfully') throw new ProbeError('SOURCE_GENERATING', 'Thinking is unfinished');
  if (!include) return { id: input.id, role: 'assistant', sourceKind: 'tool-image', parts: images };
  const fail = (): never => { throw new ProbeError('THINKING_FORMAT_UNSUPPORTED', 'Thinking summary needs an adapter'); };
  let texts: string[];
  if (content.content_type === 'thoughts') {
    if (!Array.isArray(content.thoughts) || content.thoughts.length > 1000) return fail();
    texts = content.thoughts.map((item: unknown) => {
      if (!isRecord(item) || typeof item.summary !== 'string' || typeof item.content !== 'string') return fail();
      if (item.finished === false) throw new ProbeError('SOURCE_GENERATING', 'Thinking is unfinished');
      return [item.summary, item.content].filter(Boolean).join('\n\n');
    });
  } else if (content.content_type === 'reasoning_recap') {
    if (typeof content.content !== 'string') return fail();
    texts = [content.content];
  } else {
    if (!Array.isArray(content.parts) || !content.parts.every((part: unknown) => typeof part === 'string')) return fail();
    texts = content.parts;
  }
  const text = texts.filter(Boolean).join('\n\n');
  if (!text.trim()) return null;
  if (text.length > 2 * 1024 * 1024) throw new ProbeError('LIMIT_EXCEEDED', 'Thinking summary exceeds limit');
  return { id: input.id, role: 'assistant', sourceKind: 'thinking', parts: [{ type: 'text', text }, ...images], contentReferences: readReferences(metadata) };
}
