import { thinkingMessage } from './thinking';
import { ProbeError, requireRecord } from '../shared/errors';
import { collectToolNames, internalMessageReason } from './message-classification';
import { attachmentDescriptions, metadataImages, parseImagePart, toolImages } from './image-parts';
import { readReferences, type ContentReference } from '../render/citations';

export interface GraphMessage {
  id: string;
  role: 'user' | 'assistant';
  sourceKind?: 'tool-image' | 'thinking';
  contentReferences?: ContentReference[];
  parts: Array<{ type: 'text'; text: string } | { type: 'image'; pointer: string; alt?: string }>;
}

export interface VerifiedPath {
  messages: GraphMessage[];
  nodeIds: string[];
  thinkingIds: string[];
  rootId: string;
  leafId: string;
  ignoredInternalMessages: number;
}

/** P0 structural validator. A valid chain is necessary, but is NOT proof that
 * a live page supplied the latest/full graph. The browser probe adds this caveat. */
export function verifyCurrentPath(input: unknown, expectedConversationId: string, enableToolImages = false, includeThinking = false): VerifiedPath {
  const source = requireRecord(input);
  if (source.conversation_id !== expectedConversationId && source.id !== expectedConversationId) {
    throw new ProbeError('IDENTITY_MISMATCH', 'Conversation identity differs');
  }
  const mapping = requireRecord(source.mapping, 'MAPPING_MISSING');
  if (Object.keys(mapping).length > 20000) throw new ProbeError('LIMIT_EXCEEDED', 'Too many nodes');
  if (typeof source.current_node !== 'string' || !source.current_node) {
    throw new ProbeError('CURRENT_NODE_MISSING', 'Current branch is unknown');
  }
  const leafId = source.current_node;
  const visited = new Set<string>();
  const chain: Array<{ id: string; node: Record<string, unknown> }> = [];
  let cursor: string | null = leafId;
  while (cursor !== null) {
    if (visited.has(cursor)) throw new ProbeError('CYCLE', 'Cycle in parent chain');
    visited.add(cursor);
    if (!Object.hasOwn(mapping, cursor)) throw new ProbeError('MISSING_PARENT', 'Incomplete parent chain');
    const node = requireRecord(mapping[cursor], 'INVALID_NODE');
    if (node.id !== cursor) throw new ProbeError('INVALID_NODE', 'Node identity mismatch');
    if (node.parent !== null && typeof node.parent !== 'string') {
      throw new ProbeError('MISSING_PARENT', 'Explicit parent or root marker required');
    }
    chain.push({ id: cursor, node });
    cursor = node.parent;
  }
  chain.reverse();
  const root = chain[0];
  if (!root) throw new ProbeError('EMPTY_GRAPH', 'No branch found');
  const messages: GraphMessage[] = [];
  const thinkingIds: string[] = [];
  const toolNames = collectToolNames(chain.map(entry => entry.node.message));
  let ignoredInternalMessages = 0;
  for (let index = 0; index < chain.length; index++) {
    const entry = chain[index]!;
    const next = chain[index + 1];
    if (next && (!Array.isArray(entry.node.children) || !entry.node.children.includes(next.id))) {
      throw new ProbeError('BROKEN_EDGE', 'Parent/child relationship is inconsistent');
    }
    if (entry.node.message === null) {
      if (index !== 0) throw new ProbeError('MISSING_MESSAGE', 'Non-root message is absent');
      continue;
    }
    const rawMessage = requireRecord(entry.node.message);
    if (thinkingMessage(rawMessage, toolNames, false) !== undefined && typeof rawMessage.id === 'string') thinkingIds.push(rawMessage.id);
    const message = parseVisibleMessage(entry.node.message, toolNames, enableToolImages, includeThinking);
    if (message) messages.push(message);
    else ignoredInternalMessages++;
  }
  if (messages.length === 0) throw new ProbeError('EMPTY_GRAPH', 'No visible messages');
  return { messages, thinkingIds, nodeIds: chain.map(item => item.id), rootId: root.id, leafId, ignoredInternalMessages };
}

/** Shared content rules; callers separately prove identity, ordering and range. */
export function parseVisibleMessage(input: unknown, toolNames: ReadonlySet<string> = new Set(), enableToolImages = false, includeThinking = false): GraphMessage | null {
    const message = requireRecord(input, 'MISSING_MESSAGE');
    const author = requireRecord(message.author, 'UNKNOWN_ROLE');
    const thinking = thinkingMessage(message, toolNames, includeThinking);
    if (thinking !== undefined) return thinking;
    const channel = message.channel;
    if (internalMessageReason(message, toolNames)) return null;
    if (author.role === 'tool') {
      // Candidate adapter remains opt-in until a real generated-image sample
      // verifies association with the visible answer and the complete manifest.
      if (!enableToolImages) throw new ProbeError('TOOL_IMAGE_REQUIRES_ASSET_ADAPTER', 'Tool image needs an asset adapter');
      if (message.status !== 'finished_successfully') throw new ProbeError('SOURCE_GENERATING', 'Tool image is unfinished');
      if (typeof message.id !== 'string' || !message.id) throw new ProbeError('INVALID_NODE', 'Tool image ID missing');
      const parts = toolImages(message);
      if (!parts.length) throw new ProbeError('UNSUPPORTED_TOOL_CONTENT', 'Tool image data absent');
      return { id: message.id, role: 'assistant', sourceKind: 'tool-image', parts };
    }
    if (author.role !== 'user' && author.role !== 'assistant') {
      throw new ProbeError('UNKNOWN_ROLE', 'Unsupported message role');
    }
    // Pionxzh's exporter retains user-facing commentary across channel changes.
    // Internal reasoning, hidden messages and tool calls were filtered above;
    // preserve commentary addressed to the user instead of dropping its text.
    if (channel != null && channel !== 'final' && !(author.role === 'assistant' && channel === 'commentary')) {
      throw new ProbeError('UNSUPPORTED_CHANNEL', 'Message channel requires an adapter');
    }
    if (author.role === 'assistant' && message.status !== 'finished_successfully') {
      throw new ProbeError('SOURCE_GENERATING', 'Assistant message is unfinished or failed');
    }
    const content = requireRecord(message.content, 'UNSUPPORTED_CONTENT');
    if (content.content_type !== 'text' && content.content_type !== 'multimodal_text') {
      throw new ProbeError('UNSUPPORTED_CONTENT', 'Content type needs a verified adapter');
    }
    if (!Array.isArray(content.parts) || content.parts.length === 0) {
      throw new ProbeError('MISSING_MESSAGE', 'Message parts are absent');
    }
    const parts: GraphMessage['parts'] = content.parts.map((part: unknown) => {
      if (typeof part === 'string') return { type: 'text', text: part };
      const image = parseImagePart(part);
      if (image) return image;
      throw new ProbeError('UNSUPPORTED_CONTENT', 'Unknown content part; refusing partial capture');
    });
    for (const image of metadataImages(message)) {
      if (!parts.some(part => part.type === 'image' && part.pointer.replace(/^sediment:\/\//, '') === image.pointer.replace(/^sediment:\/\//, ''))) parts.push(image);
    }
    for (const description of attachmentDescriptions(message, parts.flatMap(part => part.type === 'image' ? [part.pointer] : []))) parts.push({ type: 'text', text: description });
    if (typeof message.id !== 'string') throw new ProbeError('INVALID_NODE', 'Message ID missing');
    const references = readReferences(message.metadata);
    return { id: message.id, role: author.role, parts, ...(references.length ? { contentReferences: references } : {}) };
}
