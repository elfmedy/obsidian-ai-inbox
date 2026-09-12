import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InboxWriter, type VaultStore } from '../spikes/core/writer';
import { startInboxServer } from '../spikes/transport/inbox-server';
import { ProbeError } from '../spikes/shared/errors';
import { request as httpRequest } from 'node:http';
describe('alpha loopback protocol', () => {
  it('checks origin, host, token and vault before writing, and supports idempotent receipts', async () => {
    const files = new Map<string, string>();
    const store: VaultStore = {
      read: async path => files.get(path) ?? null, create: async (path, text) => { files.set(path, text); },
      replace: async (path, expected, text, guard) => { if (files.get(path) !== expected || !guard()) throw new ProbeError('REPLAN_REQUIRED', 'Changed'); files.set(path, text); },
      editor: () => [], markdownPaths: () => [...files.keys()], readBinary: async () => null,
      createBinary: async () => undefined, saveState: async () => undefined,
      attachmentPath: async filename => filename,
    };
    const vaultId = randomUUID(); const token = 'a'.repeat(64);
    const server = await startInboxServer({ writer: new InboxWriter(store, null), vaultId, token, vaultName: 'Synthetic', port: 0, confirmPair: async () => true });
    const endpoint = `http://127.0.0.1:${server.port}`; const headers = { Authorization: `Bearer ${token}`, 'X-AI-Inbox-Vault': vaultId };
    try {
      const firstVault = await startInboxServer({ writer: new InboxWriter(store, null), vaultId: randomUUID(), token, vaultName: 'Port A' });
      try {
        const secondVault = await startInboxServer({ writer: new InboxWriter(store, null), vaultId: randomUUID(), token, vaultName: 'Port B' });
        try { expect(secondVault.port).not.toBe(firstVault.port); expect(secondVault.port).toBeGreaterThanOrEqual(27125); expect(secondVault.port).toBeLessThanOrEqual(27134); }
        finally { await secondVault.close(); }
      } finally { await firstVault.close(); }
      const advert = await (await fetch(`${endpoint}/v1/discovery`)).json();
      expect(advert).toMatchObject({ app: 'ai-inbox', vaultId, pairingVersion: 1 }); expect(JSON.stringify(advert)).not.toContain(token);
      expect((await fetch(`${endpoint}/v1/discovery`, { headers: { Origin: 'https://chatgpt.com' } })).status).toBe(403);
      const clientId = 'a'.repeat(32); const secret = 'b'.repeat(64);
      const pairHeaders = { 'Content-Type': 'application/json', Origin: `chrome-extension://${clientId}` };
      const start = await (await fetch(`${endpoint}/v1/pair`, { method: 'POST', headers: pairHeaders, body: JSON.stringify({ clientId, secret }) })).json();
      expect(start.connection).toBeUndefined();
      const approved = await (await fetch(`${endpoint}/v1/pair/status`, { method: 'POST', headers: pairHeaders, body: JSON.stringify({ clientId, secret, pairId: start.pairId }) })).json();
      expect(approved.connection).toEqual({ endpoint: endpoint + '/', vaultId, token });
      const unauthorized = await fetch(`${endpoint}/v1/pair/status`, { method: 'POST', headers: pairHeaders, body: JSON.stringify({ clientId, secret: 'c'.repeat(64), pairId: start.pairId }) });
      expect(unauthorized.ok).toBe(false); expect(await unauthorized.text()).not.toContain(token);
      expect((await fetch(`${endpoint}/v1/export-options`)).status).toBe(401);
      expect(await (await fetch(`${endpoint}/v1/export-options`, { headers })).json()).toEqual({ includeThinking: false, includeTitle: false, language: 'zh' });
      expect((await fetch(`${endpoint}/v1/hello`)).status).toBe(401);
      expect((await fetch(`${endpoint}/v1/hello`, { headers: { ...headers, Origin: 'https://chatgpt.com' } })).status).toBe(403);
      const wrongHostStatus = await new Promise<number | undefined>((resolve, reject) => {
        httpRequest(`${endpoint}/v1/hello`, { headers: { ...headers, Host: 'evil.example' } }, response => {
          response.resume(); resolve(response.statusCode);
        }).on('error', reject).end();
      });
      expect(wrongHostStatus).toBe(403);
      expect((await fetch(`${endpoint}/v1/hello`, { headers: { ...headers, 'X-AI-Inbox-Vault': randomUUID() } })).status).toBe(401);
      expect((await fetch(`${endpoint}/v1/hello`, { headers: { ...headers, Origin: `chrome-extension://${'a'.repeat(32)}` } })).status).toBe(200);
      expect((await fetch(`${endpoint}/v1/read?path=secret.md`, { headers })).status).toBe(404);
      const data = { requestId: randomUUID(), expectedRevision: 0, snapshot: { schemaVersion: 1, conversationId: 'sample', sourceUrl: 'https://chatgpt.com/c/sample',
        title: 'Example', capturedAt: new Date().toISOString(), messages: [{ id: 'one', role: 'user', parts: [{ type: 'text', text: 'Safe text' }] }], assets: [] } };
      const save = (value: unknown) => fetch(`${endpoint}/v1/save`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      const first = await save(data); expect(first.status).toBe(200); const receipt: unknown = await first.json();
      expect(await (await save(data)).json()).toEqual(receipt); expect(files.size).toBe(1);
      expect(await (await fetch(`${endpoint}/v1/requests/${data.requestId}`, { headers })).json()).toEqual({ receipt });
      expect((await save({ ...data, requestId: randomUUID() })).status).toBe(409);
      expect((await save({ ...data, requestId: randomUUID(), expectedRevision: 1, path: '../outside.md' })).status).toBe(422); expect(files.size).toBe(1);
    } finally { await server.close(); }
  });
});
