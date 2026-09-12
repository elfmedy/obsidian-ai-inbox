import { describe, expect, it } from 'vitest';
import { verifyCurrentPath } from '../spikes/capture/graph';
import { decodeTable, extractJsonDocuments, findConversationGraphs } from '../spikes/capture/hydration';
import { makeGraph } from './fixtures/graph';

describe('P0 graph verification (synthetic fixtures, not live proof)', () => {
  it('preserves commentary on the verified parent chain', () => {
    const graph = makeGraph(); graph.mapping.m1.message.channel = 'commentary'; graph.mapping.m1.message.recipient = 'all';
    const result = verifyCurrentPath(graph, 'synthetic-conversation');
    expect(result.messages.map(message => message.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(result.messages[1]?.parts).toEqual([{ type: 'text', text: graph.mapping.m1.message.content.parts[0] }]);
  });
  it('captures all 200 messages in order independent of DOM position', () => {
    const result = verifyCurrentPath(makeGraph(200), 'synthetic-conversation');
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0]?.id).toBe('m0');
    expect(result.messages.at(-1)?.id).toBe('m199');
  });
  it('uses only the current branch', () => {
    const graph = makeGraph();
    graph.mapping.other = { ...graph.mapping.m3, id: 'other', message: { ...graph.mapping.m3.message, id: 'other' } };
    graph.mapping.m2.children.push('other');
    expect(verifyCurrentPath(graph, 'synthetic-conversation').messages.map(m => m.id)).not.toContain('other');
  });
  it.each(['missing-parent', 'missing-current', 'cycle', 'broken-edge', 'unfinished', 'unknown-part', 'unknown-role'])('rejects %s instead of partial success', mode => {
    const graph = makeGraph();
    if (mode === 'missing-parent') delete graph.mapping.m1;
    if (mode === 'missing-current') graph.current_node = 'absent';
    if (mode === 'cycle') graph.mapping.root.parent = 'm3';
    if (mode === 'broken-edge') graph.mapping.m1.children = [];
    if (mode === 'unfinished') graph.mapping.m3.message.status = 'in_progress';
    if (mode === 'unknown-part') graph.mapping.m3.message.content.parts = [{ content_type: 'audio' }];
    if (mode === 'unknown-role') graph.mapping.m2.message.author.role = 'unknown';
    expect(() => verifyCurrentPath(graph, 'synthetic-conversation')).toThrow();
  });
  it('does not accept a different conversation', () => {
    expect(() => verifyCurrentPath(makeGraph(), 'different')).toThrow();
  });
  it('retains image pointers without pretending they are downloaded', () => {
    const graph = makeGraph();
    graph.mapping.m3.message.content = { content_type: 'multimodal_text', parts: ['图片：', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://fixture' }] };
    expect(verifyCurrentPath(graph, 'synthetic-conversation').messages.at(-1)?.parts[1]?.type).toBe('image');
  });
  it('decodes data references without executing JavaScript', () => {
    const table = [{ _1: 2 }, 'name', 'fixture'];
    expect(decodeTable(table)).toEqual({ name: 'fixture' });
    const script = `window.__reactRouterContext.streamController.enqueue(${JSON.stringify(JSON.stringify(table) + '\n')});`;
    expect(extractJsonDocuments([script])).toEqual([{ name: 'fixture' }]);
    expect(extractJsonDocuments(['globalThis.shouldNotRun = true'])).toEqual([]);
  });
  it('avoids prototype pollution and handles cyclic references', () => {
    const result = decodeTable([{ _1: 2, _3: 0 }, '__proto__', { _3: 4 }, 'self', 'unsafe']) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(result.self).toBe(result);
  });
  it('finds only matching graph objects and terminates with cycles', () => {
    const root: Record<string, unknown> = { data: makeGraph() };
    root.self = root;
    expect(findConversationGraphs([root], 'synthetic-conversation')).toHaveLength(1);
    expect(findConversationGraphs([root], 'different')).toHaveLength(0);
  });
});
