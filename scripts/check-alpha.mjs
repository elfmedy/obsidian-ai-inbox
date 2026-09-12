import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const base = resolve(root, 'dist/alpha');
const json = async path => JSON.parse(await readFile(resolve(base, path), 'utf8'));
const plugin = await json('obsidian-plugin/manifest.json'); const extension = await json('chrome-extension/manifest.json');
assert.deepEqual(plugin, JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')));
const bundle = await readFile(resolve(base, 'obsidian-plugin/main.js'), 'utf8');
for (const file of ['LICENSE', 'third-party/chatgpt-exporter.LICENSE', 'third-party/chatgpt-conversation-export.LICENSE',
  'third-party/owlct-export.LICENSE', 'third-party/npm-dependencies.txt']) {
  assert.ok(bundle.includes((await readFile(resolve(root, file), 'utf8')).replaceAll('*/', '* /')), `BRAT bundle missing ${file}`);
}
assert.equal(plugin.id, 'ai-inbox'); assert.equal(plugin.version, extension.version); assert.equal(plugin.author, 'elfmedy'); assert.equal(plugin.isDesktopOnly, true);
assert.equal((await json('obsidian-plugin/versions.json'))[plugin.version], plugin.minAppVersion);
assert.equal(extension.action.default_popup, undefined); assert.equal(extension.commands._execute_action.suggested_key, undefined);
assert.deepEqual(extension.host_permissions, ['http://127.0.0.1/*']);
assert.deepEqual(extension.permissions.sort(), ['activeTab', 'contextMenus', 'scripting', 'storage'].sort());
const background = await readFile(resolve(base, 'chrome-extension/inbox-background.js'), 'utf8');
assert.doesNotMatch(background, /setBadge|setIcon\(|setTitle\(/);
async function tree(directory, prefix = '') {
  const result = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name); const key = `${prefix}${item.name}`;
    if (item.isDirectory()) Object.assign(result, await tree(path, `${key}/`));
    else { assert.doesNotMatch(item.name, /data\.json|Connection\.md|pasted-text|\.map$/); result[key] = createHash('sha256').update(await readFile(path)).digest('hex'); }
  }
  return result;
}
for (const target of ['obsidian-plugin', 'chrome-extension']) {
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party/chatgpt-exporter.LICENSE', 'third-party/chatgpt-conversation-export.LICENSE',
    'third-party/owlct-export.LICENSE', 'third-party/npm-dependencies.txt']) {
    assert.equal(await readFile(resolve(base, target, name), 'utf8'), await readFile(resolve(root, name), 'utf8'));
  }
}
const before = await tree(base); const rebuild = spawnSync(process.execPath, ['scripts/build-alpha.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(rebuild.status, 0, rebuild.stderr); assert.deepEqual(await tree(base), before);
console.log('Alpha metadata, fixed action UI, license inventory, and deterministic build passed. This is not live acceptance or store approval.');
