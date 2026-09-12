import { describe, it, expect } from 'vitest';
import { inspectMessageList } from '../spikes/capture/message-list';
import { diagnosticText } from '../spikes/extension/inbox-diagnostics';
import { feedbackText } from '../spikes/extension/inbox-text';
import type { Feedback } from '../spikes/extension/inbox-types';

describe('capture failure diagnostics', () => {
  it('retains the failing index and cause without source values or unknown field names', () => {
    const result = inspectMessageList({ conversation_id: 'private-chat', current_node: 'private-message', messages: [{
      id: 'private-message', author: { role: 'user' }, content: { content_type: 'text', parts: ['private-body'] },
      metadata: { attachments: [{ file: { 'private-key': 'private-value' }, url: 'https://private.example/secret' }] },
    }] }, 'private-chat', 'complete');
    expect(result.diagnostics.issues).toContain('ATTACHMENT_INVALID');
    expect(result.diagnostics.failedMessages[0]).toMatchObject({ index: 0, code: 'ATTACHMENT_INVALID' });
    const report = diagnosticText({ stage: 'error', code: 'ATTACHMENT_INVALID', notSubmitted: true,
      pageUrl: 'private-page', vaultName: 'private-vault', diagnostics: { adapterVersion: 2, phase: 'reading',
        httpStatus: 200, requestCode: 'CURRENT_CHAT_MESSAGE_ARRAY_UNVERIFIED', validation: result.diagnostics } }, '0.1.1');
    expect(report).not.toContain('private'); expect(report).toContain('unknownFields');
    expect(JSON.parse(report).notSubmitted).toBe(true);
  });
  it('classifies malformed citation URLs as a specific cause', () => {
    const result = inspectMessageList({ conversation_id: 'chat', current_node: 'one', messages: [{ id: 'one', author: { role: 'assistant' }, status: 'finished_successfully',
      content: { content_type: 'text', parts: ['Answer'] }, metadata: { content_references: [{ type: 'webpage', url: 'private-invalid-url' }] },
    }] }, 'chat', 'complete');
    expect(result.diagnostics.issues).toContain('CITATION_URL_INVALID');
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-invalid-url');
  });
  it('distinguishes pre-submission failures from unknown commit outcomes', () => {
    const data: Feedback = { stage: 'error', code: 'CAPTURE_FAILED', notSubmitted: true };
    expect(feedbackText(data, true)).toContain('本次未提交笔记');
    expect(feedbackText({ ...data, notSubmitted: false }, true)).toContain('保存结果尚未确认');
  });
});
