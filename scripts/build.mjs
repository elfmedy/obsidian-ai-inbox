import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, cp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import './dependency-notices.mjs';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const browser = manifest.manifest_version === 3;
const destination = resolve(root, 'dist', browser ? 'browser-extension' : 'obsidian-plugin');
if (dirname(destination) !== resolve(root, 'dist')) throw Error('Unexpected build directory');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
if (browser) {
  for (const entry of ['background', 'capture', 'card', 'options', 'status']) await build({
    entryPoints: [resolve(root, `src/extension/inbox-${entry}.ts`)], bundle: true,
    outfile: resolve(destination, `inbox-${entry}.js`), platform: 'browser', format: 'iife', target: 'chrome120' });
  for (const file of ['options.html', 'status.html', 'inbox.css']) await copyFile(resolve(root, 'src/extension', file), resolve(destination, file));
  for (const size of [16, 32, 48, 128]) await copyFile(resolve(root, `src/extension/icons/icon-${size}.png`), resolve(destination, `icon-${size}.png`));
} else {
  // BRAT installs only runtime files: embed the complete license inventory.
  const licenses = await Promise.all(['LICENSE', 'THIRD_PARTY_NOTICES.md', ...(await readdir(resolve(root, 'third-party'))).sort().map(file => `third-party/${file}`)]
    .map(file => readFile(resolve(root, file), 'utf8')));
  await build({ entryPoints: [resolve(root, 'src/obsidian/inbox.ts')], bundle: true, outfile: resolve(destination, 'main.js'),
    platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian'],
    banner: { js: '/*\n' + licenses.join('\n\n').replaceAll('*/', '* /') + '\n*/' } });
  await copyFile(resolve(root, 'versions.json'), resolve(destination, 'versions.json'));
}
for (const file of ['manifest.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(resolve(root, file), resolve(destination, file));
await cp(resolve(root, 'third-party'), resolve(destination, 'third-party'), { recursive: true });
console.log(`Built ${browser ? 'browser extension' : 'Obsidian plugin'} ${manifest.version}: ${destination}`);
