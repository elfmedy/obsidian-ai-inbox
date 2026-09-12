import { afterEach, describe, expect, it } from 'vitest';
import { allowPageImage, detectImageType, readBounded } from '../spikes/assets/inspect';
import { FIXTURE_HASH, FIXTURE_PNG, parseMetrics, startProbeServer } from '../spikes/transport/server';
import { hash } from '../spikes/persistence/policy';
import { isCitationFavicon } from '../spikes/assets/content-image';
import { crc32, inflateSync } from 'node:zlib';
import { ownedArrayBuffer } from '../spikes/assets/binary';

const token = 'a'.repeat(64);
const headers = { Authorization: `Bearer ${token}`, 'X-AI-Inbox-Vault': 'test-vault' };
const metrics = { graphCandidates: 1, verifiedGraphs: 1, visibleMessages: 4, capturedMessages: 200,
  imageElements: 2, downloadedImages: 2, decodedImages: 2, failedImages: 0,
  chainMatchesVisible: true, requiresLiveValidation: true as const };
const servers: Awaited<ReturnType<typeof startProbeServer>>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

describe('bounded image inspection', () => {
  it('passes only visible image bytes to Vault even for a pooled Buffer', () => {
    const allocation = Buffer.allocUnsafe(8192).fill(0xa5);
    const image = allocation.subarray(117, 117 + FIXTURE_PNG.length);
    image.set(FIXTURE_PNG);
    const buffer = ownedArrayBuffer(image);
    expect(buffer.byteLength).toBe(FIXTURE_PNG.length);
    expect(hash(new Uint8Array(buffer))).toBe(FIXTURE_HASH);
    image.fill(0);
    expect(hash(new Uint8Array(buffer))).toBe(FIXTURE_HASH);
  });
  it('uses a PNG with valid chunk checksums and a decodable pixel', () => {
    let offset = 8;
    const pixels: Buffer[] = [];
    while (offset < FIXTURE_PNG.length) {
      const length = FIXTURE_PNG.readUInt32BE(offset);
      const chunk = FIXTURE_PNG.subarray(offset + 4, offset + 8 + length);
      expect(crc32(chunk)).toBe(FIXTURE_PNG.readUInt32BE(offset + 8 + length));
      if (chunk.subarray(0, 4).toString() === 'IDAT') pixels.push(chunk.subarray(4));
      offset += 12 + length;
    }
    expect(inflateSync(Buffer.concat(pixels))).toEqual(Buffer.from([0, 56, 130, 246, 255]));
  });
  it('excludes the observed citation icon endpoint without excluding content images', () => {
    expect(isCitationFavicon('https://www.google.com/s2/favicons?domain=example.com&sz=128')).toBe(true);
    expect(isCitationFavicon('https://chatgpt.com/backend-api/estuary/content?id=fixture')).toBe(false);
    expect(isCitationFavicon('https://www.google.com/photo.png')).toBe(false);
  });
  it('recognizes fixture PNG and rejects an HTML login response', () => {
    expect(detectImageType(FIXTURE_PNG)).toBe('image/png');
    expect(() => detectImageType(new TextEncoder().encode('<html>please login</html>'))).toThrow();
  });
  it('enforces actual size even if content-length is absent', async () => {
    await expect(readBounded(new Response(new Uint8Array(30)), 10)).rejects.toThrow('Actual image size');
  });
  it('rejects oversized declared responses and failed status', async () => {
    await expect(readBounded(new Response('small', { headers: { 'Content-Length': '100' } }), 10)).rejects.toThrow();
    await expect(readBounded(new Response('forbidden', { status: 403 }))).rejects.toThrow('403');
  });
  it.each(['http://127.0.0.1/a.png', 'https://127.0.0.1/a.png', 'file:///x.png', 'https://evil.test/a.png',
    'https://chatgpt.com@evil.test/x', 'https://a.openai.com:1234/x', 'blob:https://evil.test/id'])('rejects unverified image destination %s', url => {
    expect(allowPageImage(url, 'https://chatgpt.com')).toBe(false);
  });
  it('allows only same-page blobs and known image origins in the P0 probe', () => {
    expect(allowPageImage('blob:https://chatgpt.com/id', 'https://chatgpt.com')).toBe(true);
    expect(allowPageImage('https://files.oaiusercontent.com/image', 'https://chatgpt.com')).toBe(true);
  });
});

describe('real loopback HTTP probe', () => {
  it('roundtrips image bytes and records only validated metrics', async () => {
    const reports: unknown[] = [];
    const images: Uint8Array[] = [];
    const server = await startProbeServer({ token, vaultId: 'test-vault', onReport: async value => { reports.push(value); }, onImage: async value => { images.push(value); } });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${baseUrl}/v1/hello`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/hello`, { headers: { ...headers, 'X-AI-Inbox-Vault': 'wrong' } })).status).toBe(401);
    const fixture = await readBounded(await fetch(`${baseUrl}/v1/fixture.png`, { headers }));
    expect(hash(fixture)).toBe(FIXTURE_HASH);
    expect((await fetch(`${baseUrl}/v1/fixture.png`, { method: 'POST', headers, body: fixture.slice().buffer })).status).toBe(200);
    expect(hash(images[0]!)).toBe(FIXTURE_HASH);
    expect((await fetch(`${baseUrl}/v1/probe`, { method: 'POST', headers, body: JSON.stringify(metrics) })).status).toBe(200);
    expect(reports).toEqual([metrics]);
    expect((await fetch(`${baseUrl}/read-file?path=secret.md`, { headers })).status).toBe(404);
    expect((await fetch(`${baseUrl}/v1/fixture.png`, { method: 'POST', headers, body: 'not an image' })).status).toBe(422);
  });
  it('rejects report data containing chat content and over-limit payloads', async () => {
    const server = await startProbeServer({ token, vaultId: 'test-vault', onReport: async () => undefined });
    servers.push(server);
    const url = `http://127.0.0.1:${server.port}/v1/probe`;
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...metrics, text: 'private content' }) })).status).toBe(400);
    expect((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(5000) })).status).toBe(413);
    expect(() => parseMetrics({ ...metrics, requiresLiveValidation: false })).toThrow();
  });
});
