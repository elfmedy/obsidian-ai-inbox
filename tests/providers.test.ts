import { describe, expect, it } from 'vitest';
import { conversationKey, conversationLocation } from '../src/shared/providers';
import { Snapshot } from '../src/core/schema';
describe('provider identity', () => {
  it('canonicalizes supported paths and rejects spoofed or non-chat pages', () => {
    expect(conversationLocation('https://gemini.google.com/u/2/app/test_1?hl=zh#x')).toEqual({ provider: 'gemini', id: 'test_1', url: 'https://gemini.google.com/app/test_1' });
    expect(conversationLocation('https://claude.ai/chat/abc')?.provider).toBe('claude');
    for (const url of ['https://chatgpt.com/', 'https://claude.ai/new', 'chrome://extensions', 'https://chatgpt.com.evil/c/a', 'https://user:pass@claude.ai/chat/a', 'http://claude.ai/chat/a']) expect(conversationLocation(url)).toBeNull();
    expect(conversationKey('chatgpt', 'same')).toBe('same'); expect(conversationKey('claude', 'same')).toBe('claude:same');
  });
  it('rejects a provider/url mismatch and accepts legacy ChatGPT payloads', () => {
    const data = { schemaVersion: 1, conversationId: 'test', sourceUrl: 'https://chatgpt.com/c/test', title: 'Title', capturedAt: new Date().toISOString(), messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }], assets: [] };
    expect(Snapshot.safeParse(data).success).toBe(true);
    expect(Snapshot.safeParse({ ...data, provider: 'claude' }).success).toBe(false);
    expect(Snapshot.safeParse({ ...data, provider: 'claude', sourceUrl: 'https://claude.ai/chat/test' }).success).toBe(true);
  });
});
