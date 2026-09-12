import { isRecord, ProbeError } from '../shared/errors';
import { parseVisibleMessage, type GraphMessage } from './graph';
import { summarizeMessageShapes } from './graph-shape';
import { collectToolNames, internalMessageReason } from './message-classification';
import { summarizeFailure } from './failure-shape';

export type PageCoverage = 'unknown' | 'partial' | 'complete';

/** Field names and boundary behavior observed in the user's page_info capture.
 * Both false flags AND matching sequence boundaries are required. */
export function messageListCoverage(input: unknown): PageCoverage {
  if (!isRecord(input) || !isRecord(input.page_info) || !Array.isArray(input.messages)) return 'unknown';
  const page = input.page_info;
  if (typeof page.has_previous_page !== 'boolean' || typeof page.has_next_page !== 'boolean') return 'unknown';
  if (page.has_previous_page || page.has_next_page) return 'partial';
  const known = ['has_previous_page', 'has_next_page', 'start_cursor', 'end_cursor'];
  if (Object.keys(page).some(key => !known.includes(key))) return 'unknown';
  const first: unknown = input.messages[0];
  const last: unknown = input.messages.at(-1);
  if (typeof page.start_cursor !== 'string' || !page.start_cursor || typeof page.end_cursor !== 'string' || !page.end_cursor ||
      !isRecord(first) || !isRecord(last) || page.start_cursor !== first.id || page.end_cursor !== last.id ||
      page.end_cursor !== input.current_node) return 'unknown';
  return 'complete';
}

/** The new endpoint exposes a sequence, not parent/child mapping. Never invent
 * graph edges. Validation remains experimental until live history tests pass. */
export function inspectMessageList(input: unknown, expectedId: string, coverage: PageCoverage = 'unknown', enableToolImages = false) {
  const source = isRecord(input) ? input : {};
  const records: unknown[] = Array.isArray(source.messages) ? source.messages : [];
  const diagnostics = { recordCount: records.length, coverage, identityMatches: source.conversation_id === expectedId,
    uniqueIds: true, currentNodeAtEnd: false, recognizedVisibleMessages: 0, ignoredInternalMessages: 0,
    validated: false, issues: [] as string[], ignoredReasons: {} as Record<string, number>, shape: summarizeMessageShapes(records),
    failedMessages: [] as Array<{ index: number; code: string; fields: ReturnType<typeof summarizeFailure> }> };
  const messages: GraphMessage[] = [];
  const reject = (code: string) => { if (!diagnostics.issues.includes(code)) diagnostics.issues.push(code); };
  if (!diagnostics.identityMatches) reject('IDENTITY_MISMATCH');
  if (records.length === 0) reject('EMPTY_MESSAGE_ARRAY');
  if (records.length > 20000) reject('LIMIT_EXCEEDED');
  if (coverage !== 'complete') reject(coverage === 'partial' ? 'MESSAGE_ARRAY_PARTIAL' : 'MESSAGE_ARRAY_PAGINATION_UNKNOWN');
  const ids = new Set<string>();
  const toolNames = records.length <= 20000 ? collectToolNames(records) : new Set<string>();
  if (diagnostics.identityMatches && records.length <= 20000) {
    for (const [index, record] of records.entries()) {
      if (!isRecord(record) || typeof record.id !== 'string' || !record.id) { reject('MESSAGE_ID_MISSING'); continue; }
      if (ids.has(record.id)) { diagnostics.uniqueIds = false; reject('DUPLICATE_MESSAGE_ID'); }
      ids.add(record.id);
      try {
        const message = parseVisibleMessage(record, toolNames, enableToolImages);
        if (message) messages.push(message);
        else {
          diagnostics.ignoredInternalMessages++;
          const reason = internalMessageReason(record, toolNames) ?? 'hidden';
          diagnostics.ignoredReasons[reason] = (diagnostics.ignoredReasons[reason] ?? 0) + 1;
        }
      } catch (error) {
        const code = error instanceof ProbeError ? error.code : 'MESSAGE_INVALID'; reject(code);
        if (diagnostics.failedMessages.length < 3) diagnostics.failedMessages.push({ index, code, fields: summarizeFailure(record) });
      }
    }
    const last = records.at(-1);
    diagnostics.currentNodeAtEnd = typeof source.current_node === 'string' && isRecord(last) && last.id === source.current_node;
    if (!diagnostics.currentNodeAtEnd) reject('MESSAGE_ARRAY_ORDER_UNCONFIRMED');
  }
  diagnostics.recognizedVisibleMessages = messages.length;
  if (messages.length === 0) reject('NO_VISIBLE_MESSAGES');
  diagnostics.validated = diagnostics.issues.length === 0;
  return { diagnostics, messages: diagnostics.validated ? messages : [] };
}
