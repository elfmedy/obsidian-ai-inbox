import { isRecord, ProbeError } from '../shared/errors';
import { toolImages } from './image-parts';

export function collectToolNames(messages: unknown[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (isRecord(message) && isRecord(message.author) && message.author.role === 'tool' &&
        typeof message.author.name === 'string' && message.author.name.length > 0 && message.author.name.length <= 256) {
      names.add(message.author.name);
    }
  }
  return names;
}

export function recipientKind(recipient: unknown, toolNames: ReadonlySet<string>): 'absent' | 'all' | 'tool' | 'unverified' {
  if (recipient == null) return 'absent';
  if (recipient === 'all') return 'all';
  if (typeof recipient !== 'string' || !recipient || recipient.length > 256) return 'unverified';
  // Some tool responses name the namespace, others name the exact method.
  const namespace = recipient.split('.')[0]!;
  for (const name of toolNames) {
    if (name === recipient || name === namespace || name.split('.')[0] === namespace) return 'tool';
  }
  return 'unverified';
}

export function internalMessageReason(message: Record<string, unknown>, toolNames: ReadonlySet<string>): string | null {
  const author = isRecord(message.author) ? message.author : {};
  if (author.role === 'system') return 'system';
  if (author.role === 'tool') {
    if (toolImages(message).length > 0) return null;
    return 'tool-result';
  }
  if (isRecord(message.metadata) && message.metadata.is_visually_hidden_from_conversation === true) return 'hidden';
  if (author.role !== 'assistant') return null;
  const type = isRecord(message.content) ? message.content.content_type : null;
  if (message.channel === 'analysis') return 'analysis';
  if (type === 'model_editable_context') return 'model-context';
  if (type === 'thoughts' || type === 'reasoning_recap') return 'reasoning';
  const recipient = recipientKind(message.recipient, toolNames);
  if (recipient === 'tool') return 'tool-call';
  if (recipient === 'unverified') throw new ProbeError('UNVERIFIED_ASSISTANT_RECIPIENT', 'Recipient needs a verified adapter');
  return null;
}
