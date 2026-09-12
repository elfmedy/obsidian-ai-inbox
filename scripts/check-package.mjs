import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const json = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const versions = await json('versions.json');
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.isDesktopOnly, true);
assert.equal(pkg.license, 'MIT');
assert.match(await readFile(resolve(root, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 elfmedy/);
assert.equal(manifest.id, 'ai-inbox');
const p0Manifest = await json('spikes/obsidian/p0/manifest.json');
assert.equal(p0Manifest.id, 'ai-inbox-p0');
assert.deepEqual(await json('dist/p0/obsidian-plugin/manifest.json'), p0Manifest);
assert.equal((await json('dist/p0/chrome-extension/manifest.json')).version, p0Manifest.version);

async function digestTree(directory, result = {}) {
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await digestTree(path, result);
    else result[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  }
  return result;
}
const before = await digestTree('dist/p0');
const built = spawnSync(process.execPath, ['scripts/build-p0.mjs'], { cwd: root, encoding: 'utf8' });
assert.equal(built.status, 0, built.stderr);
assert.deepEqual(await digestTree('dist/p0'), before, 'Same-source build bytes changed');
assert.ok(before['dist/p0/obsidian-plugin/main.js']);
assert.ok(before['dist/p0/obsidian-plugin/LICENSE']);
for (const target of ['obsidian-plugin', 'chrome-extension']) {
  for (const file of ['THIRD_PARTY_NOTICES.md', 'third-party/chatgpt-conversation-export.LICENSE', 'third-party/chatgpt-exporter.LICENSE',
    'third-party/owlct-export.LICENSE', 'third-party/npm-dependencies.txt']) {
    assert.equal(await readFile(resolve(root, `dist/p0/${target}/${file}`), 'utf8'),
      await readFile(resolve(root, file), 'utf8'), 'Third-party attribution missing or changed');
  }
}
console.log('P0 package metadata and repeat-build byte equality passed. Not a community release certification.');
