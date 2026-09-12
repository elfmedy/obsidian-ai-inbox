import { isRecord } from '../shared/errors';
import { collectToolNames, recipientKind } from './message-classification';

/** Report only allowlisted schema categories, never arbitrary field values. */
export function summarizeGraphShape(graph: Record<string, unknown>) {
  const mapping = isRecord(graph.mapping) ? graph.mapping : {};
  return summarizeMessageShapes(Object.values(mapping).map(node => isRecord(node) ? node.message : null));
}

export function summarizeMessageShapes(messages: unknown[]) {
  const channels: Record<string, number> = {};
  const contentTypes: Record<string, number> = {};
  const roles: Record<string, number> = {};
  const recipients: Record<string, number> = {};
  function count(target: Record<string, number>, value: unknown, allowed: string[]) {
    const key = value == null ? 'absent' : typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
    target[key] = (target[key] ?? 0) + 1;
  }
  let hiddenByMetadata = 0;
  if (messages.length > 20000) return { nodes: messages.length, channels, contentTypes, roles, recipients, hiddenByMetadata, truncated: true };
  const toolNames = collectToolNames(messages);
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (isRecord(message.metadata) && message.metadata.is_visually_hidden_from_conversation === true) hiddenByMetadata++;
    if (isRecord(message.author) && message.author.role === 'assistant') {
      const recipient = recipientKind(message.recipient, toolNames);
      recipients[recipient] = (recipients[recipient] ?? 0) + 1;
    }
    count(channels, message.channel, ['analysis', 'final', 'commentary', 'summary', 'complete', 'notification']);
    count(roles, isRecord(message.author) ? message.author.role : null, ['user', 'assistant', 'system', 'tool']);
    count(contentTypes, isRecord(message.content) ? message.content.content_type : null,
      ['text', 'multimodal_text', 'image_asset_pointer', 'model_editable_context', 'thoughts', 'reasoning_recap', 'code', 'execution_output', 'tether_browsing_display', 'audio', 'video']);
  }
  return { nodes: messages.length, channels, contentTypes, roles, recipients, hiddenByMetadata, truncated: false };
}
