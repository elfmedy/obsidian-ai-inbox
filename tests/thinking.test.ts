import { describe, expect, it } from 'vitest';
import { parseVisibleMessage, verifyCurrentPath } from '../spikes/capture/graph';
import { inspectMessageList } from '../spikes/capture/message-list';
import { ContentSettings, resolveLanguage } from '../spikes/shared/export-options';
import { translate } from '../spikes/obsidian/i18n';

const thought = { id: 'thought', author: { role: 'assistant' }, recipient: 'all', status: 'finished_successfully',
  metadata: { is_visually_hidden_from_conversation: true }, content: { content_type: 'thoughts',
    thoughts: [{ summary: 'Synthetic summary', content: 'Synthetic expanded content\n\n- Detail', finished: true }] } };
const final = { id: 'answer', author: { role: 'assistant' }, channel: 'final', status: 'finished_successfully', content: { content_type: 'text', parts: ['Answer'] } };
describe('optional UI thinking summaries', () => {
  it('defaults off; opt-in reads the pinned summary shape, not raw analysis', () => {
    expect(parseVisibleMessage(thought)).toBeNull();
    const result = parseVisibleMessage(thought, new Set(), true, true);
    expect(result?.sourceKind).toBe('thinking');
    expect(result?.parts).toEqual([{ type: 'text', text: 'Synthetic summary\n\nSynthetic expanded content\n\n- Detail' }]);
    expect(parseVisibleMessage({ ...final, channel: 'analysis' }, new Set(), true, true)).toBeNull();
  });
  it('recognizes thinking activities without dropping ordinary commentary or final answers', () => {
    const activity = { ...final, channel: 'commentary', metadata: { reasoning_title: 'Synthetic activity' } };
    expect(parseVisibleMessage(activity)).toBeNull();
    expect(parseVisibleMessage(activity, new Set(), true, true)?.sourceKind).toBe('thinking');
    expect(parseVisibleMessage({ ...activity, metadata: {} })?.sourceKind).toBeUndefined();
    expect(parseVisibleMessage({ ...activity, channel: 'final' })?.parts).toEqual([{ type: 'text', text: 'Answer' }]);
  });
  it('keeps image attachments in a thinking activity when the thinking text is excluded', () => {
    const activity = { ...final, channel: 'commentary', metadata: { reasoning_title: 'Synthetic activity', attachments: [{ mime_type: 'image/png', id: 'synthetic-image' }] } };
    const message = parseVisibleMessage(activity, new Set(), true);
    expect(message?.sourceKind).toBe('tool-image');
    expect(message?.parts.every(part => part.type === 'image')).toBe(true);
    expect(message?.parts).toHaveLength(1);
  });
  it('rejects unsupported or unfinished summaries only when requested', () => {
    const malformed = { ...thought, content: { content_type: 'thoughts', thoughts: [{ chunks: ['Unknown format'] }] } };
    expect(parseVisibleMessage(malformed)).toBeNull();
    expect(() => parseVisibleMessage(malformed, new Set(), true, true)).toThrow('adapter');
    expect(() => parseVisibleMessage({ ...thought, status: 'in_progress' }, new Set(), true, true)).toThrow('unfinished');
  });
  it('supports recap strings and excludes tool input, context, and hidden ordinary text', () => {
    expect(parseVisibleMessage({ ...thought, content: { content_type: 'reasoning_recap', content: 'Thought for 3 seconds' } }, new Set(), true, true)?.parts)
      .toEqual([{ type: 'text', text: 'Thought for 3 seconds' }]);
    expect(parseVisibleMessage({ ...thought, recipient: 'browser.search' }, new Set(['browser']), true, true)).toBeNull();
    expect(parseVisibleMessage({ ...final, content: { content_type: 'model_editable_context' } }, new Set(), true, true)).toBeNull();
    expect(parseVisibleMessage({ ...final, metadata: { is_visually_hidden_from_conversation: true } }, new Set(), true, true)).toBeNull();
  });
  it('preserves source order and expanded UI identities in the new message array', () => {
    const source = { conversation_id: 'chat', current_node: 'answer', messages: [thought, final] };
    const excluded = inspectMessageList(source, 'chat', 'complete');
    expect(excluded.thinkingIds).toEqual(['thought']);
    expect(excluded.messages.map(message => message.id)).toEqual(['answer']);
    expect(inspectMessageList(source, 'chat', 'complete', true, true).messages.map(message => message.id)).toEqual(['thought', 'answer']);
  });
  it('handles the older graph without weakening parent-chain verification', () => {
    const source = { conversation_id: 'chat', current_node: 'answer', mapping: {
      thought: { id: 'thought', parent: null, children: ['answer'], message: thought },
      answer: { id: 'answer', parent: 'thought', children: [], message: final },
    } };
    expect(verifyCurrentPath(source, 'chat', true).thinkingIds).toEqual(['thought']);
    expect(verifyCurrentPath(source, 'chat', true, true).messages.map(message => message.id)).toEqual(['thought', 'answer']);
    source.mapping.answer.parent = 'missing';
    expect(() => verifyCurrentPath(source, 'chat', true, true)).toThrow('Incomplete');
  });
});
describe('vault content preferences and interface language', () => {
  it('migrates missing settings to both switches off and follows Obsidian', () => {
    expect(ContentSettings.parse({})).toEqual({ includeThinking: false, includeTitle: false, language: 'auto' });
    expect(resolveLanguage('auto', 'zh-TW')).toBe('zh');
    expect(resolveLanguage('auto', 'en')).toBe('en');
    expect(resolveLanguage('auto', 'de')).toBe('en');
    expect(resolveLanguage('zh', 'en')).toBe('zh');
    expect(resolveLanguage('en', 'zh')).toBe('en');
  });
  it('has translated UI messages including pairing and failure paths', () => {
    for (const key of ['pairTitle', 'allow', 'settingsFailed', 'failed', 'resetFailed', 'thinking', 'title'] as const) {
      expect(translate('en', key)).not.toMatch(/[\u4e00-\u9fff]/);
      expect(translate('zh', key)).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
