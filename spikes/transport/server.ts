import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ProbeError, requireRecord } from '../shared/errors';
import { detectImageType, MAX_IMAGE_BYTES } from '../assets/inspect';

export interface StoredContentImage {
  path: string; previewPath: string; sha256: string; byteLength: number; mime: string;
}

export const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwaPr2HwAFVgKwVpOyIwAAAABJRU5ErkJggg==', 'base64');
export const FIXTURE_HASH = createHash('sha256').update(FIXTURE_PNG).digest('hex');

export interface ProbeMetrics {
  graphCandidates: number;
  verifiedGraphs: number;
  visibleMessages: number;
  capturedMessages: number;
  imageElements: number;
  downloadedImages: number;
  decodedImages: number;
  failedImages: number;
  chainMatchesVisible: boolean;
  requiresLiveValidation: true;
}

export function parseMetrics(value: unknown): ProbeMetrics {
  const input = requireRecord(value);
  const counts = ['graphCandidates', 'verifiedGraphs', 'visibleMessages', 'capturedMessages',
    'imageElements', 'downloadedImages', 'decodedImages', 'failedImages'] as const;
  const keys = [...counts, 'chainMatchesVisible', 'requiresLiveValidation'];
  if (Object.keys(input).some(key => !keys.includes(key))) throw new ProbeError('INVALID_REPORT', 'Unexpected report field');
  for (const key of counts) {
    if (!Number.isInteger(input[key]) || (input[key] as number) < 0 || (input[key] as number) > 20000) {
      throw new ProbeError('INVALID_REPORT', 'Invalid metric');
    }
  }
  if (typeof input.chainMatchesVisible !== 'boolean' || input.requiresLiveValidation !== true) {
    throw new ProbeError('INVALID_REPORT', 'Probe cannot certify production completeness');
  }
  return input as unknown as ProbeMetrics;
}

export async function startProbeServer(options: {
  token: string;
  vaultId: string;
  port?: number;
  onReport: (metrics: ProbeMetrics) => Promise<void>;
  onImage?: (bytes: Uint8Array) => Promise<void>;
  onContentImage?: (bytes: Uint8Array, sha256: string) => Promise<StoredContentImage>;
}) {
  if (options.token.length < 32) throw new ProbeError('TOKEN_WEAK', 'Probe token is too short');
  const tokenDigest = createHash('sha256').update(`Bearer ${options.token}`).digest();
  let mutationTail = Promise.resolve();
  async function serial(action: () => Promise<void>) {
    const work = mutationTail.then(action);
    mutationTail = work.catch(() => undefined);
    await work;
  }
  function reply(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  }
  async function body(request: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const data = Buffer.from(chunk as Uint8Array);
      size += data.length;
      if (size > limit) throw new ProbeError('LIMIT_EXCEEDED', 'Request body too large');
      chunks.push(data);
    }
    return Buffer.concat(chunks);
  }
  const server = createServer((request, response) => {
    void (async () => {
      const digest = createHash('sha256').update(request.headers.authorization ?? '').digest();
      if (!timingSafeEqual(digest, tokenDigest) || request.headers['x-ai-inbox-vault'] !== options.vaultId) {
        reply(response, 401, { code: 'UNAUTHORIZED' }); return;
      }
      const route = `${request.method} ${request.url}`;
      if (route === 'GET /v1/hello') {
        reply(response, 200, { protocolVersion: 'p0', vaultId: options.vaultId, fixtureHash: FIXTURE_HASH,
          capabilities: options.onContentImage ? ['content-image-v1'] : [] });
      } else if (route === 'GET /v1/fixture.png') {
        response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': FIXTURE_PNG.length });
        response.end(FIXTURE_PNG);
      } else if (route === 'POST /v1/probe') {
        const metrics = parseMetrics(JSON.parse((await body(request, 4096)).toString('utf8')) as unknown);
        await serial(() => options.onReport(metrics));
        reply(response, 200, { status: 'probe-recorded', productionReady: false });
      } else if (route === 'POST /v1/fixture.png') {
        const bytes = await body(request, 1024);
        if (createHash('sha256').update(bytes).digest('hex') !== FIXTURE_HASH) {
          reply(response, 422, { code: 'FIXTURE_MISMATCH' }); return;
        }
        if (options.onImage) await serial(() => options.onImage!(bytes));
        reply(response, 200, { status: 'fixture-verified', byteLength: bytes.length });
      } else if (route === 'POST /v1/content-image' && options.onContentImage) {
        const expected = request.headers['x-ai-inbox-image-sha256'];
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
          reply(response, 400, { code: 'IMAGE_DIGEST_REQUIRED' }); return;
        }
        const bytes = await body(request, MAX_IMAGE_BYTES);
        if (createHash('sha256').update(bytes).digest('hex') !== expected) {
          reply(response, 422, { code: 'IMAGE_DIGEST_MISMATCH' }); return;
        }
        detectImageType(bytes);
        let stored: StoredContentImage | undefined;
        await serial(async () => { stored = await options.onContentImage!(bytes, expected); });
        if (!stored || stored.sha256 !== expected || stored.byteLength !== bytes.length) throw new ProbeError('IMAGE_WRITE_UNVERIFIED', 'Image write was not verified');
        reply(response, 200, { status: 'content-image-verified', ...stored, productionReady: false });
      } else reply(response, 404, { code: 'NOT_FOUND' });
    })().catch(error => {
      const code = error instanceof ProbeError ? error.code : 'PROBE_FAILED';
      reply(response, code === 'LIMIT_EXCEEDED' ? 413 : 400, { code });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
