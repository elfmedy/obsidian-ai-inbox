// Exercises the real plugin with a synthetic fixture. Never prints connection credentials.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const vault = resolve(import.meta.dirname, '../.local/p0-vault');
const marker = JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8'));
assert.equal(marker.purpose, 'ai-inbox-p0-isolated-tests');
const run = (await readdir(join(vault, 'P0'))).filter(name => /^run-\d+-[a-f0-9]+$/.test(name)).sort().at(-1);
assert.ok(run);
const directory = join(vault, 'P0', run);
const source = await readFile(join(directory, 'Connection.md'), 'utf8');
const match = /```json\r?\n([^\r\n]+)\r?\n```/.exec(source);
assert.ok(match);
const connection = JSON.parse(match[1]);
assert.equal(connection.vaultId, marker.vaultId);
assert.equal(connection.endpoint, 'http://127.0.0.1:27126/');
const headers = { Authorization: `Bearer ${connection.token}`, 'X-AI-Inbox-Vault': connection.vaultId };
const hello = await fetch(new URL('v1/hello', connection.endpoint), { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
assert.ok((await hello.json()).capabilities.includes('content-image-v1'));
const bytes = await readFile(join(directory, 'fixture.png'));
const digest = input => createHash('sha256').update(input).digest('hex');
const sha256 = digest(bytes);
const upload = () => fetch(new URL('v1/content-image', connection.endpoint), { method: 'POST',
  headers: { ...headers, 'X-AI-Inbox-Image-SHA256': sha256 }, body: bytes,
  redirect: 'error', signal: AbortSignal.timeout(10000) });
const response = await upload();
assert.equal(response.status, 200);
const receipt = await response.json();
assert.equal(receipt.path, `P0/${run}/content-images/${sha256}.png`);
assert.equal(receipt.previewPath, `P0/${run}/content-images/${sha256}.md`);
const image = join(vault, receipt.path);
const preview = join(vault, receipt.previewPath);
assert.equal(digest(await readFile(image)), sha256);
assert.match(await readFile(preview, 'utf8'), /!\[\[P0\/run-/);
const before = await stat(image);
const duplicate = await upload();
assert.equal(duplicate.status, 200);
assert.equal((await stat(image)).mtimeMs, before.mtimeMs);
const report = { kind: 'real-obsidian-content-image-fixture', at: new Date().toISOString(),
  run, httpStatus: response.status, duplicateStatus: duplicate.status,
  bytes: bytes.length, storedBytes: (await stat(image)).size,
  readbackMatches: true, duplicateDidNotOverwrite: true, previewPath: receipt.previewPath,
  chromeVerified: false, realChatImageVerified: false, offlineDisplayVerified: false, fullP0Passed: false };
await writeFile(join(directory, 'content-image-runtime-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
