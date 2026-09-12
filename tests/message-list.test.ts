import { describe, expect, it } from 'vitest';
import { inspectMessageList, messageListCoverage } from '../spikes/capture/message-list';
import { makeGraph } from './fixtures/graph';

function fixture(count = 4) {
  const graph = makeGraph(count);
  return { conversation_id: 'synthetic-conversation', current_node: graph.current_node,
    messages: Object.values(graph.mapping).filter(node => node.message).map(node => node.message) };
}

describe('new message array adapter (synthetic coverage evidence)', () => {
  it('accepts the observed pagination schema only when both flags and both cursors confirm the bounds', () => {
    const source = { ...fixture(), page_info: { start_cursor: 'm0', end_cursor: 'm3', has_previous_page: false, has_next_page: false } };
    expect(messageListCoverage(source)).toBe('complete');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, has_previous_page: true } })).toBe('partial');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, has_next_page: true } })).toBe('partial');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, start_cursor: 'missing' } })).toBe('unknown');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, end_cursor: 'm2' } })).toBe('unknown');
    expect(messageListCoverage({ ...source, current_node: 'm2' })).toBe('unknown');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, has_next_page: null } })).toBe('unknown');
    expect(messageListCoverage({ ...source, page_info: { ...source.page_info, unverified_flag: false } })).toBe('unknown');
    expect(messageListCoverage(fixture())).toBe('unknown');
  });
  it('preserves a 200-message sequence without fabricating graph edges', () => {
    const result = inspectMessageList(fixture(200), 'synthetic-conversation', 'complete');
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0]?.id).toBe('m0');
    expect(result.messages.at(-1)?.id).toBe('m199');
    expect(result.diagnostics.validated).toBe(true);
  });
  it.each(['unknown', 'partial'] as const)('does not certify range with %s coverage', coverage => {
    const result = inspectMessageList(fixture(), 'synthetic-conversation', coverage);
    expect(result.messages).toEqual([]);
    expect(result.diagnostics.recognizedVisibleMessages).toBe(4);
    expect(result.diagnostics.validated).toBe(false);
  });
  it('rejects another chat, duplicated IDs and unconfirmed sequence order', () => {
    expect(inspectMessageList(fixture(), 'other', 'complete').messages).toEqual([]);
    const duplicate = fixture();
    duplicate.messages[1].id = duplicate.messages[0].id;
    expect(inspectMessageList(duplicate, 'synthetic-conversation', 'complete').diagnostics.issues).toContain('DUPLICATE_MESSAGE_ID');
    const reversed = fixture();
    reversed.messages.reverse();
    expect(inspectMessageList(reversed, 'synthetic-conversation', 'complete').diagnostics.issues).toContain('MESSAGE_ARRAY_ORDER_UNCONFIRMED');
  });
  it('excludes only recognized internal messages and does not silently skip unknown visible content', () => {
    const source = fixture();
    source.messages[0].author.role = 'system';
    source.messages[1].channel = 'analysis';
    const result = inspectMessageList(source, 'synthetic-conversation', 'complete');
    expect(result.messages).toHaveLength(2);
    expect(result.diagnostics.ignoredInternalMessages).toBe(2);
    source.messages[2].content.content_type = 'unverified-format';
    const rejected = inspectMessageList(source, 'synthetic-conversation', 'complete');
    expect(rejected.messages).toEqual([]);
    expect(rejected.diagnostics.issues).toContain('UNSUPPORTED_CONTENT');
  });
});
