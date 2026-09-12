import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, cp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import './dependency-notices.mjs';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
// BRAT installs main.js and manifest.json; retain the complete license inventory in the bundle.
const licenses = await Promise.all(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'third-party/chatgpt-exporter.LICENSE',
  'third-party/chatgpt-conversation-export.LICENSE', 'third-party/owlct-export.LICENSE', 'third-party/npm-dependencies.txt']
  .map(file => readFile(resolve(root, file), 'utf8')));
const licenseBanner = '/*\n' + licenses.join('\n\n').replaceAll('*/', '* /') + '\n*/';
const plugin = resolve(root, 'dist/alpha/obsidian-plugin');
const extension = resolve(root, 'dist/alpha/chrome-extension');
await mkdir(plugin, { recursive: true }); await mkdir(extension, { recursive: true });
await build({ entryPoints: [resolve(root, 'spikes/obsidian/inbox.ts')], bundle: true, outfile: resolve(plugin, 'main.js'),
  platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'], banner: { js: licenseBanner } });
for (const entry of ['background', 'capture', 'card', 'options', 'status']) await build({
  entryPoints: [resolve(root, `spikes/extension/inbox-${entry}.ts`)], bundle: true, outfile: resolve(extension, `inbox-${entry}.js`),
  platform: 'browser', format: 'iife', target: 'chrome120' });
for (const file of ['options.html', 'status.html', 'inbox.css']) await copyFile(resolve(root, `spikes/extension/${file}`), resolve(extension, file));
for (const file of ['manifest.json', 'versions.json']) await copyFile(resolve(root, file), resolve(plugin, file));
// Original vector icon, rasterized with antialiasing for toolbar sizes.
for (const size of [16, 32, 48, 128]) await copyFile(resolve(root, 'spikes/extension/icons/icon-' + size + '.png'), resolve(extension, 'icon-' + size + '.png'));
const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icon-${size}.png`]));
await writeFile(resolve(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'AI Inbox', version: manifest.version, minimum_chrome_version: '120',
  description: 'Save the current ChatGPT conversation and images to Obsidian with one click.',
  permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'], host_permissions: ['http://127.0.0.1/*'],
  background: { service_worker: 'inbox-background.js' }, action: { default_title: 'AI Inbox', default_icon: icons }, icons,
  options_ui: { page: 'options.html', open_in_tab: true }, commands: { _execute_action: {} },
}, null, 2));
for (const target of [plugin, extension]) {
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(resolve(root, file), resolve(target, file));
  await cp(resolve(root, 'third-party'), resolve(target, 'third-party'), { recursive: true });
}
console.log(`Alpha ${manifest.version} built in dist/alpha. Live Chrome acceptance is still required.`);
