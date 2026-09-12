import { describe, expect, it } from 'vitest';
import { inspectMessageList, messageListCoverage } from '../spikes/capture/message-list';
import { parseVisibleMessage } from '../spikes/capture/graph';

function message(id: string, role: string, contentType = 'text', recipient: string | null = null) {
  return { id, author: { role, name: role === 'tool' ? 'fixture_tool' : null },
    recipient, channel: null as string | null, status: 'finished_successfully',
    content: { content_type: contentType, parts: [`synthetic ${id}`] }, metadata: {} as Record<string, unknown> };
}

describe('observed message categories with synthetic content', () => {
  it('retains user-facing commentary before the final answer in source order', () => {
    const commentary = { ...message('progress', 'assistant', 'text', 'all'), channel: 'commentary' };
    const final = { ...message('final', 'assistant', 'text', 'all'), channel: 'final' };
    const source = { conversation_id: 'fixture', current_node: 'final', messages: [message('user', 'user'), commentary, final],
      page_info: { start_cursor: 'user', end_cursor: 'final', has_previous_page: false, has_next_page: false } };
    const result = inspectMessageList(source, 'fixture', messageListCoverage(source));
    expect(result.diagnostics.validated).toBe(true);
    expect(result.messages.map(item => item.id)).toEqual(['user', 'progress', 'final']);
    expect(result.messages[1]?.parts).toEqual([{ type: 'text', text: commentary.content.parts[0] }]);
  });
  it('reproduces the reported 22-record shape while retaining all five user-facing records', () => {
    const sourceMessages = [message('s1', 'system'), message('context', 'assistant', 'model_editable_context'), message('u1', 'user'),
      message('t1', 'assistant', 'thoughts'), { ...message('progress', 'assistant', 'text', 'all'), channel: 'commentary' },
      ...Array.from({ length: 4 }, (_, index) => message(`call-${index}`, 'assistant', 'text', 'fixture_tool.run')),
      ...Array.from({ length: 6 }, (_, index) => message(`result-${index}`, 'tool')),
      message('t2', 'assistant', 'thoughts'), message('r1', 'assistant', 'reasoning_recap'),
      { ...message('a1', 'assistant', 'text', 'all'), channel: 'final' }, message('s2', 'system'), message('u2', 'user'),
      message('r2', 'assistant', 'reasoning_recap'), { ...message('a2', 'assistant', 'text', 'all'), channel: 'final' }];
    const result = inspectMessageList({ conversation_id: 'fixture', current_node: 'a2', messages: sourceMessages }, 'fixture', 'complete');
    expect(result.diagnostics.recordCount).toBe(22); expect(result.diagnostics.ignoredInternalMessages).toBe(17);
    expect(result.diagnostics.validated).toBe(true);
    expect(result.messages.map(item => item.id)).toEqual(['u1', 'progress', 'a1', 'u2', 'a2']);
  });
  it('still excludes hidden and tool-directed commentary and rejects unfinished commentary', () => {
    const commentary = { ...message('progress', 'assistant', 'text', 'all'), channel: 'commentary' };
    expect(parseVisibleMessage({ ...commentary, metadata: { is_visually_hidden_from_conversation: true } })).toBeNull();
    expect(parseVisibleMessage({ ...commentary, recipient: 'fixture_tool.run' }, new Set(['fixture_tool']))).toBeNull();
    expect(() => parseVisibleMessage({ ...commentary, status: 'in_progress' })).toThrow('unfinished');
    expect(() => parseVisibleMessage({ ...commentary, recipient: 'unknown.run' })).toThrow('Recipient');
    expect(() => parseVisibleMessage({ ...commentary, channel: 'unknown-channel' })).toThrow('channel');
  });
  it.each([
    { content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'synthetic' }] } },
    { content: { content_type: 'image_asset', image_asset: { asset_pointer: 'synthetic' } } },
    { metadata: { aggregate_result: { messages: [{ message_type: 'image', image_url: 'synthetic' }] } } },
    { metadata: { attachments: [{ mime_type: 'image/png', id: 'synthetic' }] } },
  ])('refuses to silently discard tool-generated image shapes: %j', shape => {
    expect(() => parseVisibleMessage({ ...message('tool-image', 'tool'), ...shape }))
      .toThrow('Tool image needs an asset adapter');
  });
  it('reduces an 18-record shape to the user image and final answer, preserving their bodies', () => {
    const system = message('s', 'system');
    system.metadata.is_visually_hidden_from_conversation = true;
    const user = message('u', 'user', 'multimodal_text', 'all');
    const final = message('final', 'assistant', 'text', 'all');
    final.channel = 'final';
    final.content.parts = ['# Answer\n\n```js\nconst x = 1;\n```\n\n[Source](https://example.com)'];
    const messages = [system, message('context', 'assistant', 'model_editable_context'), user,
      message('thought-1', 'assistant', 'thoughts'), message('thought-2', 'assistant', 'thoughts'),
      ...Array.from({ length: 5 }, (_, index) => message(`call-${index}`, 'assistant', 'text', 'fixture_tool.run')),
      ...Array.from({ length: 6 }, (_, index) => message(`result-${index}`, 'tool')),
      message('recap', 'assistant', 'reasoning_recap'), final];
    const source = { conversation_id: 'fixture', current_node: 'final', messages,
      page_info: { start_cursor: 's', end_cursor: 'final', has_previous_page: false, has_next_page: false } };
    const result = inspectMessageList(source, 'fixture', messageListCoverage(source));
    expect(result.diagnostics.recordCount).toBe(18);
    expect(result.diagnostics.ignoredInternalMessages).toBe(16);
    expect(result.diagnostics.ignoredReasons).toEqual({ system: 1, 'model-context': 1, reasoning: 3, 'tool-call': 5, 'tool-result': 6 });
    expect(result.diagnostics.shape.contentTypes).toEqual({ text: 13, model_editable_context: 1, multimodal_text: 1, thoughts: 2, reasoning_recap: 1 });
    expect(result.diagnostics.validated).toBe(true);
    expect(result.messages.map(item => item.id)).toEqual(['u', 'final']);
    expect(result.messages[1]?.parts).toEqual([{ type: 'text', text: final.content.parts[0] }]);
  });
  it('does not ignore user content just because it mentions reasoning or tools', () => {
    const user = message('u', 'user');
    user.content.parts = ['thoughts reasoning_recap fixture_tool.run'];
    expect(parseVisibleMessage(user)?.parts).toEqual([{ type: 'text', text: user.content.parts[0] }]);
    user.content.content_type = 'thoughts';
    expect(() => parseVisibleMessage(user)).toThrow('Content type');
  });
  it('refuses unknown assistant recipients instead of exporting tool commands or silently omitting an unknown target', () => {
    expect(() => parseVisibleMessage(message('call', 'assistant', 'text', 'unverified.run'))).toThrow('Recipient');
    expect(parseVisibleMessage(message('call', 'assistant', 'text', 'known.run'), new Set(['known']))).toBeNull();
    expect(parseVisibleMessage(message('a', 'assistant', 'text', 'all'))?.role).toBe('assistant');
  });
  it('still rejects unfinished or unsupported user-facing assistant content', () => {
    const final = message('a', 'assistant', 'text', 'all');
    final.status = 'in_progress';
    expect(() => parseVisibleMessage(final)).toThrow('unfinished');
    final.status = 'finished_successfully';
    final.content.content_type = 'unknown-visible-format';
    expect(() => parseVisibleMessage(final)).toThrow('Content type');
  });
});
