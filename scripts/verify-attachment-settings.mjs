// Isolated Vault only. Exercises Obsidian's real attachment resolver; restores
// the test Vault's attachment setting in finally and never changes credentials.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'); const vault = resolve(root, '.local/p0-vault');
assert.equal(JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8')).purpose, 'ai-inbox-p0-isolated-tests');
const config = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8'));
const cli = resolve(process.env.LOCALAPPDATA, 'Obsidian/Obsidian.com');
function evaluate(code) {
  const output = execFileSync(cli, ['vault=p0-vault', 'eval', `code=${code}`], { encoding: 'utf8', windowsHide: true });
  assert.doesNotMatch(output, /^Error:/m); return JSON.parse(output.trim().replace(/^=> /, ''));
}
const initial = evaluate('JSON.stringify({folder:app.vault.getConfig("attachmentFolderPath")})');
const headers = { Authorization: `Bearer ${config.token}`, 'X-AI-Inbox-Vault': config.vaultId };
async function request(path, init = {}) {
  const response = await fetch(`http://127.0.0.1:27125/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const data = await response.json(); assert.ok(response.ok, data.code); return data;
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwaPr2HwAFVgKwVpOyIwAAAABJRU5ErkJggg==', 'base64');
const results = [];
try {
  for (const setting of ['/', 'Test Attachments #1/[images] 50%', './', './test-images']) {
    if (setting === './test-images') evaluate(`(async()=>{await app.plugins.plugins["ai-inbox"].changeFolder(${JSON.stringify('Attachment Context Test ' + Date.now())});return JSON.stringify(true)})()`);
    evaluate(`JSON.stringify(app.vault.setConfig("attachmentFolderPath",${JSON.stringify(setting)}) ?? true)`);
    const bytes = Buffer.concat([png, Buffer.from(randomUUID())]); const sha256 = createHash('sha256').update(bytes).digest('hex');
    const asset = await request(`v1/assets/${sha256}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    const conversationId = randomUUID();
    const data = { requestId: randomUUID(), expectedRevision: 0, snapshot: { schemaVersion: 1, conversationId,
      sourceUrl: `https://chatgpt.com/c/${conversationId}`, title: `Attachment settings ${Date.now()}`, capturedAt: new Date().toISOString(),
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Synthetic attachment test' }, { type: 'image', sha256, alt: 'Attachment test' }] }], assets: [asset] } };
    const receipt = await request('v1/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const text = await readFile(join(vault, receipt.path), 'utf8');
    const imagePath = decodeURIComponent(/!\[Attachment test\]\(<\/([^>]+)>\)/.exec(text)[1]);
    const parent = receipt.path.slice(0, receipt.path.lastIndexOf('/') + 1);
    const expected = setting === '/' ? '' : setting.startsWith('./') ? parent + setting.slice(2) : setting;
    assert.equal(imagePath.slice(0, imagePath.lastIndexOf('/') + 1).replace(/\/$/, ''), expected.replace(/\/$/, ''));
    assert.equal(createHash('sha256').update(await readFile(join(vault, imagePath))).digest('hex'), sha256);
    assert.equal(evaluate(`JSON.stringify(app.metadataCache.getFirstLinkpathDest(${JSON.stringify('/' + imagePath)},${JSON.stringify(receipt.path)})?.path===${JSON.stringify(imagePath)})`), true);
    const unchanged = await request('v1/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, requestId: randomUUID(), expectedRevision: 1 }) });
    assert.equal(unchanged.action, 'unchanged');
    assert.equal(evaluate(`JSON.stringify(app.vault.getMarkdownFiles().some(file=>file.path.startsWith(${JSON.stringify(parent)})&&file.name.startsWith("AI Inbox attachment context ")))`), false);
    results.push({ setting, imagePath, path: receipt.path, bytesVerified: true, linkResolved: true, unchanged: true });
  }
} finally {
  evaluate(`JSON.stringify(app.vault.setConfig("attachmentFolderPath",${JSON.stringify(initial.folder ?? '/')}) ?? true)`);
  evaluate(`(async()=>{await app.plugins.plugins["ai-inbox"].changeFolder(${JSON.stringify(config.folder ?? 'AI Inbox')});return JSON.stringify(true)})()`);
}
const report = { passed: true, at: new Date().toISOString(), settingsRestored: true, results };
await mkdir(resolve(root, '.local/alpha-reports'), { recursive: true });
await writeFile(resolve(root, '.local/alpha-reports/attachments.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
