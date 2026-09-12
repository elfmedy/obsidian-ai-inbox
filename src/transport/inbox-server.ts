import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { InboxWriter } from '../core/writer';
import { ProbeError } from '../shared/errors';
import { DISCOVERY_PORTS } from '../shared/discovery';
import { PairingSessions, type ConfirmPair } from './pairing';

async function readBody(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array); size += bytes.length;
    if (size > limit) throw new ProbeError('LIMIT_EXCEEDED', 'Request too large'); chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export async function startInboxServer(options: { token: string; vaultId: string; vaultName: string; port?: number; writer: InboxWriter; confirmPair?: ConfirmPair }) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new ProbeError('TOKEN_INVALID', 'Invalid connection');
  await options.writer.ready();
  const auth = createHash('sha256').update(`Bearer ${options.token}`).digest();
  const pairing = new PairingSessions(options.confirmPair);
  const server = createServer((request, response) => {
    const reply = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    void (async () => {
      const port = (server.address() as AddressInfo).port;
      if (request.headers.host !== `127.0.0.1:${port}`) { reply(403, { code: 'HOST_INVALID' }); return; }
      const origin = request.headers.origin;
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) { reply(403, { code: 'ORIGIN_INVALID' }); return; }
      const route = `${request.method} ${request.url}`;
      if (route === 'GET /v1/discovery') {
        reply(200, { app: 'ai-inbox', protocolVersion: 1, pairingVersion: options.confirmPair ? 1 : 0, vaultId: options.vaultId, vaultName: options.vaultName }); return;
      }
      if (route === 'POST /v1/pair' || route === 'POST /v1/pair/status') {
        if (request.headers['content-type'] !== 'application/json') throw new ProbeError('CONTENT_TYPE_INVALID', 'Expected JSON');
        const body: unknown = JSON.parse((await readBody(request, 2048)).toString('utf8'));
        const state = route === 'POST /v1/pair' ? pairing.start(body, origin) : pairing.poll(body, origin);
        reply(200, { ...state, ...(route === 'POST /v1/pair/status' && state.status === 'approved' ? {
          connection: { endpoint: `http://127.0.0.1:${port}/`, vaultId: options.vaultId, token: options.token } } : {}) }); return;
      }
      if (!timingSafeEqual(auth, createHash('sha256').update(request.headers.authorization ?? '').digest()) || request.headers['x-ai-inbox-vault'] !== options.vaultId) {
        reply(401, { code: 'UNAUTHORIZED' }); return;
      }
      if (route === 'GET /v1/hello') reply(200, { protocolVersion: 1, vaultId: options.vaultId, vaultName: options.vaultName });
      else if (route === 'GET /v1/export-options') reply(200, options.writer.exportOptions());
      else if (/^GET \/v1\/conversations\/[A-Za-z0-9-]{1,128}$/.test(route)) {
        await options.writer.ready(); reply(200, { revision: options.writer.revision(request.url!.split('/').at(-1)!) });
      } else if (/^GET \/v1\/requests\/[a-f0-9-]{36}$/.test(route)) {
        await options.writer.ready(); reply(200, { receipt: options.writer.status(request.url!.split('/').at(-1)!) });
      } else if (/^PUT \/v1\/assets\/[a-f0-9]{64}$/.test(route)) {
        if (request.headers['content-type'] !== 'application/octet-stream') throw new ProbeError('CONTENT_TYPE_INVALID', 'Expected bytes');
        reply(200, await options.writer.upload(await readBody(request, 25 * 1024 * 1024), request.url!.split('/').at(-1)!));
      } else if (route === 'POST /v1/save') {
        if (request.headers['content-type'] !== 'application/json') throw new ProbeError('CONTENT_TYPE_INVALID', 'Expected JSON');
        const data: unknown = JSON.parse((await readBody(request, 24 * 1024 * 1024)).toString('utf8'));
        reply(200, await options.writer.save(data));
      } else reply(404, { code: 'NOT_FOUND' });
    })().catch((error: unknown) => {
      const code = error instanceof ProbeError ? error.code : 'SAVE_FAILED';
      reply(code === 'LIMIT_EXCEEDED' ? 413 : ['REVISION_CONFLICT', 'REPLAN_REQUIRED', 'REQUEST_ID_REUSED'].includes(code) ? 409 : 422, { code });
    });
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000; server.timeout = 60000; server.maxHeadersCount = 32;
  for (const port of options.port !== undefined ? [options.port] : DISCOVERY_PORTS) {
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { server.off('error', onError); server.off('listening', onListening); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onListening = () => { cleanup(); resolve(); };
        server.once('error', onError); server.once('listening', onListening); server.listen(port, '127.0.0.1');
      }); break;
    } catch (error) {
      if (options.port !== undefined || !(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE' || port === DISCOVERY_PORTS.at(-1)) { pairing.close(); throw error; }
    }
  }
  return { port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => { pairing.close(); server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}
