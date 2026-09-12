import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const json = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const manifest = await json('manifest.json'); const pkg = await json('package.json'); const lock = await json('package-lock.json');
assert.equal(manifest.version, pkg.version); assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
const browser = manifest.manifest_version === 3; const directory = browser ? 'browser-extension' : 'obsidian-plugin';
const base = resolve(root, 'dist', directory);
assert.deepEqual(JSON.parse(await readFile(resolve(base, 'manifest.json'), 'utf8')), manifest);
const native = browser ? ['manifest.json', 'inbox-background.js', 'inbox-capture.js', 'inbox-card.js', 'inbox-options.js', 'inbox-status.js', 'options.html', 'status.html', 'inbox.css', ...[16, 32, 48, 128].map(size => `icon-${size}.png`)] : ['manifest.json', 'main.js', 'versions.json'];
const licenses = ['LICENSE', 'THIRD_PARTY_NOTICES.md', ...(await readdir(resolve(root, 'third-party'))).map(file => `third-party/${file}`)];
async function tree(directory, prefix = '') {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, item.name); const key = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await tree(file, key + '/'));
    else result[key] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return result;
}
const before = await tree(base);
assert.deepEqual(Object.keys(before).sort(), [...native, ...licenses].sort(), 'Unexpected release files');
for (const file of licenses) assert.equal(await readFile(resolve(base, file), 'utf8'), await readFile(resolve(root, file), 'utf8'));
if (browser) {
  assert.equal(manifest.action.default_popup, undefined); assert.equal(manifest.commands._execute_action.suggested_key, undefined);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
  const background = await readFile(resolve(base, 'inbox-background.js'), 'utf8');
  assert.doesNotMatch(background, /setBadge|setIcon\(|setTitle\(/);
} else {
  assert.equal(manifest.id, 'ai-inbox'); assert.equal(manifest.isDesktopOnly, true);
  assert.equal((await json('versions.json'))[manifest.version], manifest.minAppVersion);
  const bundle = await readFile(resolve(base, 'main.js'), 'utf8');
  for (const file of licenses) assert.ok(bundle.includes((await readFile(resolve(root, file), 'utf8')).replaceAll('*/', '* /')), `Missing embedded license: ${file}`);
}
const contract = await json('protocol/contract.json');
for (const [file, expected] of Object.entries(contract.sha256)) {
  const actual = createHash('sha256').update((await readFile(resolve(root, file), 'utf8')).replaceAll('\r\n', '\n')).digest('hex');
  assert.equal(actual, expected, `Protocol definition changed: ${file}. Review compatibility and update the contract deliberately.`);
}
const rebuilt = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(rebuilt.status, 0, rebuilt.stderr); assert.deepEqual(await tree(base), before, 'Build must be reproducible');
console.log('Version, package contents, licenses, protocol contract, and repeat build verified.');
