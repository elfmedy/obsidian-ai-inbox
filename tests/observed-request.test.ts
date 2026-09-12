import { describe, expect, it, vi } from 'vitest';
import { discoverRequests, probeObservedRequest } from '../spikes/capture/observed-request';
import { makeGraph } from './fixtures/graph';
import { summarizeGraphShape } from '../spikes/capture/graph-shape';
import { summarizeResponseShape } from '../spikes/capture/response-shape';

const pageUrl = 'https://chatgpt.com/c/synthetic-conversation';
const api = 'https://chatgpt.com/backend-api/conversation/synthetic-conversation';
const sessionUrl = 'https://chatgpt.com/api/auth/session';
const resource = (name: string) => ({ name, initiatorType: 'fetch' });
const session = { user: { id: 'private-user' }, expires: '2099-01-01', accessToken: 'private-session-credential' };
function json(data: unknown, url: string, status = 200) {
  const response = new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('observed current-chat request probe', () => {
  it('adapts the observed message-array envelope without requiring a mapping graph', async () => {
    const graph = makeGraph();
    const data = { conversation_id: 'synthetic-conversation', current_node: 'm3',
      messages: Object.values(graph.mapping).filter(node => node.message).map(node => node.message),
      page_info: { start_cursor: 'm0', end_cursor: 'm3', has_previous_page: false, has_next_page: false } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(data, api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, fetcher);
    expect(result.graphs).toEqual([]);
    expect(result.diagnostics.error).toBeNull();
    expect(result.diagnostics.messageArray?.validated).toBe(true);
    expect(result.messageList?.messages).toHaveLength(4);
  });
  it('rejects the new envelope when earlier pages remain and exposes no cursor values', async () => {
    const graph = makeGraph();
    const data = { conversation_id: 'synthetic-conversation', current_node: 'm3',
      messages: Object.values(graph.mapping).filter(node => node.message).map(node => node.message),
      page_info: { start_cursor: 'private-cursor', end_cursor: 'm3', has_previous_page: true, has_next_page: false } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(data, api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, fetcher);
    expect(result.diagnostics.error).toBe('CURRENT_CHAT_RESPONSE_PARTIAL');
    expect(result.messageList?.messages).toEqual([]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-cursor');
  });
  it('matches the observed plural route and preserves its turn limit while ignoring textdocs', async () => {
    const observed = api.replace('/conversation/', '/conversations/') + '?include_has_versions=true&num_turns=10';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(makeGraph(), observed));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(observed), resource(`${api}/textdocs`)], scripts: [] }, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe(observed);
    expect(result.diagnostics.conversationRequests).toBe(1);
    expect(result.diagnostics.requestedTurnLimit).toBe(10);
    expect(result.graphs).toHaveLength(1);
  });
  it('rejects unrecognized, duplicate or invalid query parameters and other chat IDs', () => {
    const plural = api.replace('/conversation/', '/conversations/');
    const resources = ['?num_turns=0', '?num_turns=10&num_turns=20', '?include_has_versions=private',
      '?token=private', '?num_turns=all'].map(query => resource(plural + query));
    resources.push(resource(`${plural}-other?num_turns=10`));
    expect(discoverRequests(resources, pageUrl).conversations).toEqual([]);
  });
  it('rejects explicit pagination even if the first page contains a structurally valid graph', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ conversation: makeGraph(), pagination: { has_more: true, next_cursor: 'private-cursor' } }, api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, fetcher);
    expect(result.diagnostics.graphCandidates).toBe(1);
    expect(result.graphs).toEqual([]);
    expect(result.diagnostics.error).toBe('CURRENT_CHAT_RESPONSE_PARTIAL');
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-cursor');
  });
  it('summarizes nested messages and pagination without exposing text, titles, IDs, cursors or unknown keys', () => {
    const shape = summarizeResponseShape({ title: 'private-title', conversation_id: 'private-id',
      data: { messages: [{ id: 'private-message-id', content: 'private-message' }],
        pagination: { has_more: false, next_cursor: 'private-cursor', total_messages: 2 } },
      'private-key': 'private-value' });
    const encoded = JSON.stringify(shape);
    expect(encoded).not.toContain('private-');
    expect(shape.objects[0]?.unknownFields).toBe(1);
    expect(shape.objects.find(object => object.location === '$.data')?.fields.messages).toEqual({ type: 'array', count: 1 });
    expect(shape.objects.find(object => object.location === '$.data.pagination')?.pagination.next_cursor).toBe('present');
    expect(shape.explicitlyPartial).toBe(false);
  });
  it('reports schema categories without copying arbitrary values or message text', () => {
    const graph = makeGraph();
    graph.mapping.m0.message.channel = 'private-channel-value';
    graph.mapping.m0.message.content.content_type = 'private-content-type';
    const shape = summarizeGraphShape(graph);
    expect(shape.channels.unknown).toBe(1);
    expect(shape.contentTypes.unknown).toBe(1);
    expect(JSON.stringify(shape)).not.toContain('private-');
    expect(JSON.stringify(shape)).not.toContain('synthetic-conversation');
  });
  it('never invents requests if the resource timeline contains no current-chat request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await probeObservedRequest({ pageUrl, resources: [], scripts: [] }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.diagnostics.error).toBe('CURRENT_CHAT_REQUEST_NOT_OBSERVED');
  });
  it('ignores other conversations, foreign origins, userinfo, query strings and non-fetch resources', () => {
    const resources = [resource(`${api}-other`), resource(api.replace('chatgpt.com', 'evil.test')),
      resource(api.replace('chatgpt.com', 'chatgpt.com.evil.test')), resource(api.replace('https://', 'https://user@')),
      resource(`${api}?token=private`), { name: api, initiatorType: 'img' }, resource(pageUrl)];
    expect(discoverRequests(resources, pageUrl).conversations).toEqual([]);
  });
  it('deduplicates repeated requests and rejects ambiguous routes', async () => {
    expect(discoverRequests([resource(api), resource(api)], pageUrl).conversations).toEqual([api]);
    const fetcher = vi.fn<typeof fetch>();
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api), resource(api.replace('/conversation/', '/f/conversation/'))], scripts: [] }, fetcher);
    expect(result.diagnostics.error).toBe('AMBIGUOUS_CHAT_REQUESTS');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reads a matching graph with an in-memory page session and reports no credential or chat identifiers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(makeGraph(), api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [JSON.stringify({ session })] }, fetcher);
    expect(result.graphs).toHaveLength(1);
    expect(result.diagnostics.authSource).toBe('page-session');
    expect(fetcher).toHaveBeenCalledWith(api, expect.objectContaining({ method: 'GET', redirect: 'error',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessToken}` } }));
    const output = JSON.stringify(result.diagnostics);
    for (const secret of [session.accessToken, session.user.id, 'synthetic-conversation', api]) expect(output).not.toContain(secret);
  });
  it('uses only an observed session request after 401, then retries once', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, api, 401))
      .mockResolvedValueOnce(json(session, sessionUrl)).mockResolvedValueOnce(json(makeGraph(), api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api), resource(sessionUrl)], scripts: [] }, fetcher);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([api, sessionUrl, api]);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ Accept: 'application/json' });
    expect(result.diagnostics.authSource).toBe('observed-session');
    expect(result.diagnostics.httpStatus).toBe(200);
    expect(result.graphs).toHaveLength(1);
  });
  it('does not guess a session URL or retry forbidden responses', async () => {
    for (const status of [401, 403]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({}, api, status));
      const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.graphs).toEqual([]);
      expect(result.diagnostics.httpStatus).toBe(status);
    }
  });
  it('rejects another conversation graph even if delivered from the expected URL', async () => {
    const graph = makeGraph();
    graph.conversation_id = 'different';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(graph, api));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, fetcher);
    expect(result.graphs).toEqual([]);
    expect(result.diagnostics.error).toBe('CURRENT_CHAT_API_NO_GRAPH');
  });
  it('rejects login redirects and masks exception details', async () => {
    const redirected = vi.fn<typeof fetch>().mockResolvedValue(json({}, 'https://chatgpt.com/'));
    expect((await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, redirected)).diagnostics.error).toBe('API_IDENTITY_CHANGED');
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error('private token in exception'));
    const result = await probeObservedRequest({ pageUrl, resources: [resource(api)], scripts: [] }, failed);
    expect(result.diagnostics.error).toBe('CURRENT_CHAT_API_REQUEST_FAILED');
    expect(JSON.stringify(result)).not.toContain('private token');
  });
});
