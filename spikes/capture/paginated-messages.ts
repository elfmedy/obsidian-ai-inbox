// Adapted from Thierry Abalea's chatgpt-conversation-export, MIT.
// Upstream: 543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324, extension/popup.js.
// See THIRD_PARTY_NOTICES.md. Added strict page checks and a final head reread.
import { isRecord, ProbeError, requireRecord } from '../shared/errors';

function reject(code: string): never { throw new ProbeError(code, 'Conversation pagination could not be verified'); }

function readPage(input: unknown, expectedId: string) {
  const source = requireRecord(input, 'PAGE_INVALID');
  if (source.conversation_id !== expectedId) reject('IDENTITY_MISMATCH');
  if (typeof source.current_node !== 'string' || !source.current_node) reject('CURRENT_NODE_MISSING');
  if (!Array.isArray(source.messages) || source.messages.length === 0) reject('PAGE_EMPTY');
  if (source.messages.length > 20000) reject('LIMIT_EXCEEDED');
  const messages: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const record of source.messages) {
    if (!isRecord(record) || typeof record.id !== 'string' || !record.id) reject('MESSAGE_ID_MISSING');
    if (seen.has(record.id)) reject('DUPLICATE_MESSAGE_ID');
    seen.add(record.id);
    messages.push(record);
  }
  const info = requireRecord(source.page_info, 'PAGE_INFO_UNKNOWN');
  const keys = ['start_cursor', 'end_cursor', 'has_previous_page', 'has_next_page'];
  if (Object.keys(info).some(key => !keys.includes(key)) ||
      typeof info.has_previous_page !== 'boolean' || typeof info.has_next_page !== 'boolean' ||
      info.start_cursor !== messages[0]!.id || info.end_cursor !== messages.at(-1)!.id) reject('PAGE_INFO_UNKNOWN');
  return { source, messages, info, currentNode: source.current_node };
}

/** Experimental API contract from upstream: before=start_cursor returns the
 * preceding segment of the same selected branch. Live long-chat proof is still
 * required; do not confuse a synthetic test with validation of that contract. */
export async function collectPaginatedMessages(initial: unknown, expectedId: string,
  fetchPage: (before: string | null) => Promise<unknown>) {
  const first = readPage(initial, expectedId);
  if (first.info.has_next_page || first.info.end_cursor !== first.currentNode) reject('MESSAGE_ARRAY_ORDER_UNCONFIRMED');
  let page = first;
  let messages = first.messages.slice();
  let pages = 1;
  let characters = JSON.stringify(initial).length;
  const seenCursors = new Set<string>();
  const started = Date.now();
  while (page.info.has_previous_page) {
    if (pages >= 100 || Date.now() - started >= 60000) reject('PAGINATION_LIMIT_EXCEEDED');
    const before = page.info.start_cursor as string;
    if (seenCursors.has(before)) reject('PAGINATION_NO_PROGRESS');
    seenCursors.add(before);
    const older = readPage(await fetchPage(before), expectedId);
    characters += JSON.stringify(older.source).length;
    if (characters > 24 * 1024 * 1024) reject('LIMIT_EXCEEDED');
    if (older.currentNode !== first.currentNode || older.source.update_time !== first.source.update_time) reject('SOURCE_CHANGED_DURING_CAPTURE');
    // Older pages must acknowledge the newer segment already in hand.
    if (!older.info.has_next_page) reject('PAGE_CONTINUITY_UNCONFIRMED');
    const seen = new Map(messages.map(record => [record.id, record]));
    const overlapAt = older.messages.findIndex(record => seen.has(record.id));
    const additions = overlapAt < 0 ? older.messages : older.messages.slice(0, overlapAt);
    // Permit only an identical suffix/prefix overlap, never silently dedupe
    // conflicting records or reorder an interleaved/repeated page.
    if (overlapAt >= 0) {
      const overlap = older.messages.slice(overlapAt);
      for (let index = 0; index < overlap.length; index++) {
        if (JSON.stringify(overlap[index]) !== JSON.stringify(messages[index])) reject('PAGE_OVERLAP_CONFLICT');
      }
    }
    if (!additions.length) reject('PAGINATION_NO_PROGRESS');
    if (messages.length + additions.length > 20000) reject('LIMIT_EXCEEDED');
    messages = additions.concat(messages);
    page = older;
    pages++;
  }
  if (pages > 1) {
    const refreshed = readPage(await fetchPage(null), expectedId);
    if (refreshed.currentNode !== first.currentNode || refreshed.source.update_time !== first.source.update_time ||
        JSON.stringify(refreshed.messages) !== JSON.stringify(first.messages) ||
        JSON.stringify(refreshed.info) !== JSON.stringify(first.info)) reject('SOURCE_CHANGED_DURING_CAPTURE');
  }
  // An assembled envelope, not a claim that the server returned it in one page.
  // The oldest response proves the start; the first response proves the end.
  return { pages, records: messages.length, headRechecked: pages > 1,
    data: { ...first.source, messages, page_info: {
      start_cursor: page.info.start_cursor, end_cursor: first.info.end_cursor,
      has_previous_page: page.info.has_previous_page, has_next_page: first.info.has_next_page,
    } } };
}
