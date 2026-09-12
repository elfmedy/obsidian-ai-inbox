import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProbeServer, FIXTURE_PNG } from '../spikes/transport/server';
import { hash } from '../spikes/persistence/policy';
import { transferPageImages } from '../spikes/extension/image-transfer';
import { summarizeProbe } from '../spikes/extension/probe-summary';
import type { PageProbeResult } from '../spikes/extension/page-probe-types';
import { inspectHydration } from '../spikes/capture/hydration';

const token = 'b'.repeat(64);
const headers = { Authorization: `Bearer ${token}`, 'X-AI-Inbox-Vault': 'test-vault' };
const servers: Awaited<ReturnType<typeof startProbeServer>>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  globalThis.aiInboxP0ImageCache = undefined;
  await Promise.all(servers.splice(0).map(server => server.close()));
});
const previewPath = (sha: string) => `P0/run-123-abc/content-images/${sha}.md`;
function report(): PageProbeResult {
  return { diagnostics: { probeVersion: 8, loaded: inspectHydration([], 'fixture').diagnostics,
    fresh: null, freshRequest: 'failed', selectedSource: 'observed-request', request: null, graphShapes: [] },
  metrics: { capturedMessages: 2, visibleMessages: 2, chainMatchesVisible: true, downloadedImages: 1,
    decodedImages: 1, failedImages: 0, imageElements: 1, graphCandidates: 0, verifiedGraphs: 0, requiresLiveValidation: true },
  issues: ['LIVE_FRESHNESS_AND_FULL_HISTORY_REQUIRE_MANUAL_VALIDATION'],
  imageTransfer: { captureId: 'synthetic-capture', offered: 1, stored: 0, status: 'pending', previewPaths: [] } };
}
async function receiver() {
  const writes: Uint8Array[] = [];
  const server = await startProbeServer({ token, vaultId: 'test-vault', onReport: async () => undefined,
    onContentImage: async (bytes, sha256) => {
      writes.push(bytes);
      return { path: `P0/${sha256}.png`, previewPath: previewPath(sha256), byteLength: bytes.length, sha256, mime: 'image/png' };
    } });
  servers.push(server);
  return { writes, endpoint: `http://127.0.0.1:${server.port}` };
}
function installPage(bytes: Uint8Array, digest = hash(bytes)) {
  const pageUrl = 'https://chatgpt.com/c/fixture';
  vi.stubGlobal('location', { href: pageUrl });
  globalThis.aiInboxP0ImageCache = { captureId: 'synthetic-capture', pageUrl, images: [{ bytes, sha256: digest }] };
  const executeScript = vi.fn(async (request: { func: (...args: never[]) => unknown; args: never[] }) => {
    return [{ result: await request.func(...request.args) }];
  });
  vi.stubGlobal('chrome', { scripting: { executeScript } });
  return { pageUrl, executeScript };
}

describe('authenticated content-image byte transfer', () => {
  it('accepts verified bytes but never supplies an arbitrary file path from the request', async () => {
    const { endpoint, writes } = await receiver();
    const hello = await (await fetch(`${endpoint}/v1/hello`, { headers })).json();
    expect(hello.capabilities).toContain('content-image-v1');
    const result = await fetch(`${endpoint}/v1/content-image`, { method: 'POST',
      headers: { ...headers, 'X-AI-Inbox-Image-SHA256': hash(FIXTURE_PNG) }, body: FIXTURE_PNG });
    expect(result.status).toBe(200);
    expect((await result.json()).byteLength).toBe(FIXTURE_PNG.length);
    expect(hash(writes[0]!)).toBe(hash(FIXTURE_PNG));
    expect((await fetch(`${endpoint}/v1/content-image?path=../other`, { method: 'POST', headers })).status).toBe(404);
  });
  it('rejects missing auth, a wrong digest and HTML disguised as an image without invoking the writer', async () => {
    const { endpoint, writes } = await receiver();
    const target = `${endpoint}/v1/content-image`;
    expect((await fetch(target, { method: 'POST' })).status).toBe(401);
    expect((await fetch(target, { method: 'POST', headers, body: FIXTURE_PNG })).status).toBe(400);
    expect((await fetch(target, { method: 'POST', headers: { ...headers, 'X-AI-Inbox-Image-SHA256': '0'.repeat(64) }, body: FIXTURE_PNG })).status).toBe(422);
    const html = new TextEncoder().encode('<html>this is not an image</html>');
    expect((await fetch(target, { method: 'POST', headers: { ...headers, 'X-AI-Inbox-Image-SHA256': hash(html) }, body: html })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });
  it('reassembles multiple JSON-safe chunks and verifies the local receiver receipt', async () => {
    // Padded synthetic bytes exercise transfer boundaries, not image decoding.
    const bytes = new Uint8Array(65536 * 2 + 19).fill(151);
    bytes.set(FIXTURE_PNG);
    const { pageUrl, executeScript } = installPage(bytes);
    const { endpoint, writes } = await receiver();
    const result = report();
    await transferPageImages(1, pageUrl, result, endpoint, headers, async () => undefined);
    expect(result.imageTransfer.status).toBe('complete');
    expect(result.imageTransfer.stored).toBe(1);
    expect(hash(writes[0]!)).toBe(hash(bytes));
    expect(result.imageTransfer.previewPaths).toEqual([previewPath(hash(bytes))]);
    expect(executeScript).toHaveBeenCalledTimes(5); // Descriptor, three chunks, cleanup.
    expect(globalThis.aiInboxP0ImageCache).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(pageUrl);
  });
  it('refuses a changed page and releases cached bytes', async () => {
    const { pageUrl } = installPage(FIXTURE_PNG);
    vi.stubGlobal('location', { href: `${pageUrl}-other` });
    const { endpoint, writes } = await receiver();
    const result = report();
    await expect(transferPageImages(1, pageUrl, result, endpoint, headers, async () => undefined)).rejects.toThrow('Capture changed');
    expect(writes).toHaveLength(0);
    expect(result.imageTransfer.status).toBe('failed');
    expect(globalThis.aiInboxP0ImageCache).toBeUndefined();
  });
  it('refuses corrupted chunks before any upload', async () => {
    const { pageUrl } = installPage(FIXTURE_PNG, '1'.repeat(64));
    const { endpoint, writes } = await receiver();
    const result = report();
    await expect(transferPageImages(1, pageUrl, result, endpoint, headers, async () => undefined)).rejects.toThrow('digest differs');
    expect(writes).toHaveLength(0);
  });
  it('does not mark success without a valid server receipt', async () => {
    const { pageUrl } = installPage(FIXTURE_PNG);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    const result = report();
    await expect(transferPageImages(1, pageUrl, result, 'http://127.0.0.1:27126', headers, async () => undefined)).rejects.toThrow('receipt');
    expect(result.imageTransfer.status).toBe('failed');
    expect(result.imageTransfer.stored).toBe(0);
  });
});

describe('human-readable P0 outcomes', () => {
  it('distinguishes a pending transfer, complete byte verification and failure from full-chat saving', () => {
    const result = report();
    expect(summarizeProbe(result)).toContain('图片落盘尚未确认');
    result.imageTransfer.status = 'complete';
    result.imageTransfer.stored = 1;
    expect(summarizeProbe(result)).toContain('1 张测试图片已写入 Vault');
    expect(summarizeProbe(result)).toContain('尚未保存聊天正文');
    result.imageTransfer.status = 'failed';
    expect(summarizeProbe(result)).toContain('不能视为保存成功');
    result.metrics.chainMatchesVisible = false;
    expect(summarizeProbe(result)).toContain('本次检查未通过');
  });
});
