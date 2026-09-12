import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import './dependency-notices.mjs';

const root = resolve(import.meta.dirname, '..');
const plugin = resolve(root, 'dist/p0/obsidian-plugin');
const extension = resolve(root, 'dist/p0/chrome-extension');
await mkdir(plugin, { recursive: true });
await mkdir(extension, { recursive: true });
await build({ entryPoints: [resolve(root, 'spikes/obsidian/main.ts')], bundle: true,
  outfile: resolve(plugin, 'main.js'), platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'] });
for (const entry of ['background', 'popup', 'page-probe']) {
  await build({ entryPoints: [resolve(root, `spikes/extension/${entry}.ts`)], bundle: true,
    outfile: resolve(extension, `${entry}.js`), platform: 'browser', format: 'iife', target: 'chrome120' });
}
for (const file of ['popup.html', 'popup.css']) await copyFile(resolve(root, `spikes/extension/${file}`), resolve(extension, file));
for (const file of ['manifest.json', 'versions.json']) await copyFile(resolve(root, 'spikes/obsidian/p0', file), resolve(plugin, file));
await copyFile(resolve(root, 'LICENSE'), resolve(plugin, 'LICENSE'));
for (const target of [plugin, extension]) {
  await copyFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), resolve(target, 'THIRD_PARTY_NOTICES.md'));
  await cp(resolve(root, 'third-party'), resolve(target, 'third-party'), { recursive: true });
}
await copyFile(resolve(root, 'LICENSE'), resolve(extension, 'LICENSE'));
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'AI Inbox P0', version: '0.0.1', minimum_chrome_version: '120',
  description: 'P0 probe: verifies chat structure and image access; never exports conversation text.',
  permissions: ['activeTab', 'scripting', 'storage'], host_permissions: ['http://127.0.0.1/*'],
  background: { service_worker: 'background.js' }, action: { default_popup: 'popup.html' },
}, null, 2));
console.log('P0 bundles created in dist/p0 (not production-ready).');
