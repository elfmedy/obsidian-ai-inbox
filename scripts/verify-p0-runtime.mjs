import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const vault = resolve(import.meta.dirname, '../.local/p0-vault');
const marker = JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8'));
assert.equal(marker.purpose, 'ai-inbox-p0-isolated-tests');
const names = (await readdir(join(vault, 'P0'))).filter(name => /^run-\d+-[a-f0-9]+$/.test(name)).sort();
const run = names.at(-1);
assert.ok(run, 'No test run');
const directory = join(vault, 'P0', run);
const connectionText = await readFile(join(directory, 'Connection.md'), 'utf8');
const match = /```json\r?\n([^\r\n]+)\r?\n```/.exec(connectionText);
assert.ok(match, 'No connection information');
const connection = JSON.parse(match[1]);
assert.equal(connection.vaultId, marker.vaultId);
assert.equal(connection.endpoint, 'http://127.0.0.1:27126/');
const headers = { Authorization: `Bearer ${connection.token}`, 'X-AI-Inbox-Vault': connection.vaultId };
const request = (path, init = {}) => fetch(new URL(path, connection.endpoint), {
  ...init, headers, redirect: 'error', signal: AbortSignal.timeout(10000),
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hello = await request('v1/hello');
const identity = await hello.json();
assert.equal(identity.vaultId, marker.vaultId);
const fixture = await request('v1/fixture.png');
assert.equal(fixture.status, 200);
const bytes = new Uint8Array(await fixture.arrayBuffer());
assert.equal(digest(bytes), identity.fixtureHash);
const uploaded = await request('v1/fixture.png', { method: 'POST', body: bytes });
const stored = await readFile(join(directory, 'transport-fixture.png'));
const report = {
  kind: 'real-obsidian-http-fixture', client: 'node-runtime-verifier', at: new Date().toISOString(),
  run, helloStatus: hello.status, uploadedStatus: uploaded.status,
  expectedBytes: bytes.length, storedBytes: stored.length,
  digestMatches: digest(stored) === identity.fixtureHash,
  passed: uploaded.status === 200 && stored.length === bytes.length && digest(stored) === identity.fixtureHash,
  chromeVerified: false, fullP0Passed: false,
};
await writeFile(join(directory, `runtime-check-${Date.now()}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
