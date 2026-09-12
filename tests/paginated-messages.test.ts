import { describe, expect, it, vi } from 'vitest';
import { collectPaginatedMessages } from '../spikes/capture/paginated-messages';
import { messageListCoverage } from '../spikes/capture/message-list';
import { probeObservedRequest } from '../spikes/capture/observed-request';

function page(start: number, end: number, previous: boolean, next: boolean) {
  return { conversation_id: 'fixture', current_node: 'm199', update_time: 1,
    messages: Array.from({ length: end - start + 1 }, (_, index) => ({ id: `m${start + index}`,
      author: { role: (start + index) % 2 === 0 ? 'user' : 'assistant' }, status: 'finished_successfully',
      content: { content_type: 'text', parts: [`synthetic ${start + index}`] } })),
    page_info: { start_cursor: `m${start}`, end_cursor: `m${end}`, has_previous_page: previous, has_next_page: next } };
}
const initial = () => page(100, 199, true, false);

describe('upstream-based current-chat pagination', () => {
  it('assembles 200 records, preserves order, rechecks the head and leaves input untouched', async () => {
    const first = initial();
    const reader = vi.fn().mockResolvedValueOnce(page(0, 99, false, true)).mockResolvedValueOnce(first);
    const result = await collectPaginatedMessages(first, 'fixture', reader);
    expect(result.pages).toBe(2);
    expect(result.headRechecked).toBe(true);
    expect(result.data.messages.map(record => record.id)).toEqual(Array.from({ length: 200 }, (_, i) => `m${i}`));
    expect(messageListCoverage(result.data)).toBe('complete');
    expect(first.messages).toHaveLength(100);
    expect(first.page_info.has_previous_page).toBe(true);
    expect(reader.mock.calls).toEqual([['m100'], [null]]);
  });
  it('handles three pages and an identical boundary overlap without duplicating messages', async () => {
    const first = page(150, 199, true, false);
    const reader = vi.fn().mockResolvedValueOnce(page(75, 155, true, true))
      .mockResolvedValueOnce(page(0, 74, false, true)).mockResolvedValueOnce(first);
    const result = await collectPaginatedMessages(first, 'fixture', reader);
    expect(result.pages).toBe(3);
    expect(result.records).toBe(200);
    expect(new Set(result.data.messages.map(record => record.id)).size).toBe(200);
  });
  it('does not fetch additional pages for a complete short response', async () => {
    const reader = vi.fn();
    const result = await collectPaginatedMessages(page(0, 199, false, false), 'fixture', reader);
    expect(result.pages).toBe(1);
    expect(reader).not.toHaveBeenCalled();
  });
  it('rejects missing pagination evidence, empty pages, bad bounds and duplicate IDs', async () => {
    const malformed: unknown[] = [
      { ...initial(), page_info: {} }, { ...initial(), messages: [] },
      { ...initial(), page_info: { ...initial().page_info, start_cursor: 'wrong' } },
      { ...initial(), messages: [initial().messages[0], initial().messages[0]] },
    ];
    for (const first of malformed) {
      const reader = vi.fn();
      await expect(collectPaginatedMessages(first, 'fixture', reader)).rejects.toThrow();
      expect(reader).not.toHaveBeenCalled();
    }
  });
  it('rejects other conversations and changes to branch or revision between pages', async () => {
    for (const change of [{ conversation_id: 'other' }, { current_node: 'other' }, { update_time: 2 }]) {
      await expect(collectPaginatedMessages(initial(), 'fixture', vi.fn().mockResolvedValue({ ...page(0, 99, false, true), ...change }))).rejects.toThrow();
    }
  });
  it('rejects changed content on the final head reread even when IDs and revision match', async () => {
    const changed = initial();
    changed.messages[0]!.content.parts = ['changed'];
    const reader = vi.fn().mockResolvedValueOnce(page(0, 99, false, true)).mockResolvedValueOnce(changed);
    await expect(collectPaginatedMessages(initial(), 'fixture', reader)).rejects.toMatchObject({ code: 'SOURCE_CHANGED_DURING_CAPTURE' });
  });
  it('rejects a repeated page or conflicting overlap instead of silently dropping records', async () => {
    await expect(collectPaginatedMessages(initial(), 'fixture', vi.fn().mockResolvedValue(page(100, 199, true, true))))
      .rejects.toMatchObject({ code: 'PAGINATION_NO_PROGRESS' });
    const conflict = page(0, 105, false, true);
    conflict.messages[100]!.content.parts = ['conflict'];
    await expect(collectPaginatedMessages(initial(), 'fixture', vi.fn().mockResolvedValue(conflict)))
      .rejects.toMatchObject({ code: 'PAGE_OVERLAP_CONFLICT' });
  });
  it('rejects an older page that disclaims the newer segment and any failed request', async () => {
    await expect(collectPaginatedMessages(initial(), 'fixture', vi.fn().mockResolvedValue(page(0, 99, false, false))))
      .rejects.toMatchObject({ code: 'PAGE_CONTINUITY_UNCONFIRMED' });
    await expect(collectPaginatedMessages(initial(), 'fixture', vi.fn().mockRejectedValue(new Error('network')))).rejects.toThrow('network');
  });
  it('bounds the number of pages even if every request appears to make progress', async () => {
    let cursor = 199;
    const reader = vi.fn().mockImplementation(() => { cursor--; return page(cursor, cursor, true, true); });
    await expect(collectPaginatedMessages(page(199, 199, true, false), 'fixture', reader))
      .rejects.toMatchObject({ code: 'PAGINATION_LIMIT_EXCEEDED' });
    expect(reader).toHaveBeenCalledTimes(99);
  });
  it('integrates only with the observed plural route, preserves page size and redacts diagnostics', async () => {
    const api = 'https://chatgpt.com/backend-api/conversations/fixture?include_has_versions=true&num_turns=10';
    const responses = [initial(), page(0, 99, false, true), initial()];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const response = new Response(JSON.stringify(responses.shift()), { headers: { 'Content-Type': 'application/json' } });
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    });
    const result = await probeObservedRequest({ pageUrl: 'https://chatgpt.com/c/fixture',
      resources: [{ name: api, initiatorType: 'fetch' }], scripts: [] }, fetcher);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([api, `${api}&before=m100`, api]);
    expect(result.diagnostics.error).toBeNull();
    expect(result.diagnostics.pagination).toEqual({ additionalRequests: 2, pages: 2, completed: true, headRechecked: true });
    expect(result.diagnostics.responseShape?.explicitlyPartial).toBe(true); // Original response retained as evidence.
    expect(result.messageList?.messages).toHaveLength(200);
    expect(JSON.stringify(result.diagnostics)).not.toContain('m100');
    expect(JSON.stringify(result.diagnostics)).not.toContain('synthetic');
  });
});
