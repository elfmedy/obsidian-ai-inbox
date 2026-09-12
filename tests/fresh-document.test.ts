import { describe, expect, it, vi } from 'vitest';
import { fetchCurrentDocument } from '../spikes/capture/fresh-document';
import { inspectHydration } from '../spikes/capture/hydration';
import { makeGraph } from './fixtures/graph';

const target = 'https://chatgpt.com/c/synthetic-conversation';
function htmlResponse(text: string, url = target, init: ResponseInit = {}) {
  const response = new Response(text, { headers: { 'Content-Type': 'text/html; charset=utf-8' }, ...init });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}
describe('fresh document probe (synthetic responses)', () => {
  it('requests exactly the current chat using its existing credentials and no redirects/cache', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('<html>fixture</html>'));
    expect(await fetchCurrentDocument(target, fetcher)).toBe('<html>fixture</html>');
    expect(fetcher).toHaveBeenCalledWith(target, expect.objectContaining({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' }));
  });
  it.each(['https://evil.test/c/id', 'http://chatgpt.com/c/id', 'https://chatgpt.com/', 'https://chatgpt.com/share/id'])('rejects non-chat target %s before fetching', async url => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(fetchCurrentDocument(url, fetcher)).rejects.toThrow('Expected current conversation');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects login/other-chat responses and non-HTML/failed responses', async () => {
    for (const response of [htmlResponse('login', 'https://chatgpt.com/'), htmlResponse('other', `${target}-other`),
      htmlResponse('{}', target, { headers: { 'Content-Type': 'application/json' } }), htmlResponse('forbidden', target, { status: 403 })]) {
      await expect(fetchCurrentDocument(target, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow();
    }
  });
  it('rejects a document larger than the bounded budget', async () => {
    const response = htmlResponse('small', target, { headers: { 'Content-Type': 'text/html', 'Content-Length': String(21 * 1024 * 1024) } });
    await expect(fetchCurrentDocument(target, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow('limit');
  });
  it('distinguishes absent data, a wrong conversation, a parse failure and matching data without reporting private content', () => {
    expect(inspectHydration([], 'synthetic-conversation').diagnostics.graphObjects).toBe(0);
    const wrong = inspectHydration([JSON.stringify(makeGraph())], 'different');
    expect(wrong.graphs).toHaveLength(0);
    expect(wrong.diagnostics.otherConversationGraphs).toBe(1);
    const correct = inspectHydration([JSON.stringify(makeGraph())], 'synthetic-conversation');
    expect(correct.diagnostics.matchingGraphs).toBe(1);
    expect(JSON.stringify(correct.diagnostics)).not.toContain('synthetic-conversation');
    const broken = inspectHydration([`window.__reactRouterContext.streamController.enqueue(${JSON.stringify('[broken')});`], 'synthetic-conversation');
    expect(broken.diagnostics.enqueueCalls).toBe(1);
    expect(broken.diagnostics.rejectedChunks).toBe(1);
  });
});
