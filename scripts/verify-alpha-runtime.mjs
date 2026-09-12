// Synthetic conversation only, using the real plugin in the marked test vault.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const vault = resolve(import.meta.dirname, '../.local/p0-vault');
assert.equal(JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8')).purpose, 'ai-inbox-p0-isolated-tests');
const config = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8'));
const endpoint = 'http://127.0.0.1:27125/';
const headers = { Authorization: `Bearer ${config.token}`, 'X-AI-Inbox-Vault': config.vaultId, Connection: 'close' };
async function request(path, init = {}) {
  const response = await fetch(new URL(path, endpoint), { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(10000) });
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
}
const hello = await request('v1/hello'); assert.equal(hello.vaultId, config.vaultId); assert.equal(hello.protocolVersion, 1);
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwaPr2HwAFVgKwVpOyIwAAAABJRU5ErkJggg==', 'base64');
const digest = input => createHash('sha256').update(input).digest('hex'); const sha256 = digest(bytes);
const asset = await request(`v1/assets/${sha256}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
const conversationId = randomUUID();
const snapshot = { schemaVersion: 1, conversationId, sourceUrl: `https://chatgpt.com/c/${conversationId}`, title: `Alpha runtime ${Date.now()}`,
  capturedAt: new Date().toISOString(), messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Synthetic question' }, { type: 'image', sha256, alt: 'Synthetic alternative text' }] },
    { id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: 'Synthetic answer\n\n```ts\nconst value = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$E=mc^2$' }] }], assets: [asset] };
const first = { requestId: randomUUID(), expectedRevision: 0, snapshot };
const save = data => request('v1/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const created = await save(first); assert.equal(created.action, 'created');
assert.deepEqual(await save(first), created);
const original = await readFile(join(vault, created.path), 'utf8'); assert.match(original, /Synthetic answer/); assert.ok(original.includes('![Synthetic alternative text]'));
const imagePath = decodeURIComponent(/!\[[^\n]+\]\(<\/([^>]+)>\)/.exec(original)[1]); assert.equal(digest(await readFile(join(vault, imagePath))), sha256);
const cli = process.env.OBSIDIAN_CLI ?? resolve(process.env.LOCALAPPDATA, 'Obsidian/Obsidian.com');
function evaluate(code) { const output = execFileSync(cli, ['vault=p0-vault', 'eval', `code=${code}`], { encoding: 'utf8', windowsHide: true }); assert.doesNotMatch(output, /^Error:/m); return output; }
const local = original.replace('source: chatgpt', 'source: chatgpt\n# Preserve this comment\ncustom: "A: B"');
evaluate(`(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(created.path)});await app.vault.modify(file,${JSON.stringify(local)});return true})()`);
const unchanged = await save({ ...first, requestId: randomUUID(), expectedRevision: 1 }); assert.equal(unchanged.action, 'unchanged');
assert.equal(await readFile(join(vault, created.path), 'utf8'), local);
snapshot.messages[1].parts[0].text += '\nChanged at source';
const updated = await save({ ...first, requestId: randomUUID(), expectedRevision: 2 }); assert.equal(updated.action, 'updated');
const changed = await readFile(join(vault, created.path), 'utf8'); assert.ok(changed.includes('# Preserve this comment')); assert.ok(changed.includes('Changed at source'));
evaluate(`(async()=>{const file=app.vault.getFileByPath(${JSON.stringify(created.path)});await app.vault.modify(file,${JSON.stringify(changed + '\nLocal edit')});return true})()`);
const forked = await save({ ...first, requestId: randomUUID(), expectedRevision: 3 }); assert.equal(forked.action, 'forked'); assert.notEqual(forked.path, created.path);
assert.ok((await readFile(join(vault, created.path), 'utf8')).endsWith('Local edit'));
assert.equal((await request(`v1/requests/${forked.requestId}`)).receipt.path, forked.path);
const resolved = evaluate(`JSON.stringify({resolved:app.metadataCache.getFirstLinkpathDest(${JSON.stringify('/' + imagePath)},${JSON.stringify(created.path)})?.path===${JSON.stringify(imagePath)}})`);
assert.ok(resolved.includes('"resolved":true'));
evaluate('(async()=>{await app.plugins.plugins["ai-inbox"].resetConnection();return true})()');
assert.equal((await fetch(new URL('v1/hello', endpoint), { headers })).status, 401);
const rotated = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8')); assert.notEqual(rotated.token, config.token);
evaluate('(async()=>{await app.plugins.disablePlugin("ai-inbox");return true})()');
await assert.rejects(() => fetch(new URL('v1/hello', endpoint), { headers, signal: AbortSignal.timeout(2000) }));
evaluate('(async()=>{await app.plugins.enablePluginAndSave("ai-inbox");return true})()');
let restarted = false;
for (let attempt = 0; attempt < 30 && !restarted; attempt++) {
  try { restarted = (await fetch(new URL('v1/hello', endpoint), { headers: { ...headers, Authorization: `Bearer ${rotated.token}` } })).status === 200; } catch { /* Layout initialization is asynchronous. */ }
  if (!restarted) await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(restarted);
const report = { at: new Date().toISOString(), kind: 'alpha-real-obsidian-synthetic-conversation', passed: true,
  created: true, duplicateIdempotent: true, unchangedWithYamlPreserved: true, updated: true, localEditForkedWithUnchangedSource: true,
  assetReadbackVerified: true, altRootLinkResolved: true, tokenRotationRejectsOldConnection: true, disableReleasesPort: true, restartKeepsConnection: true,
  requestStatusVerified: true, notePath: forked.path, liveChromeChatVerified: false };
await mkdir(resolve(import.meta.dirname, '../.local/alpha-reports'), { recursive: true });
await writeFile(resolve(import.meta.dirname, '../.local/alpha-reports/runtime.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
