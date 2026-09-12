// Developer-only regeneration. The original SVG and generated PNGs are checked
// in; normal builds only copy them and require no image-processing dependency.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dependency = createRequire(process.env.IMAGE_RUNTIME_PACKAGE ?? resolve(root, 'package.json'));
const sharp = dependency('sharp'); const folder = resolve(root, 'spikes/extension/icons');
const svg = await readFile(resolve(folder, 'icon.svg'));
for (const size of [16, 32, 48, 128]) await sharp(svg, { density: 384 }).resize(size, size).png().toFile(resolve(folder, `icon-${size}.png`));
await writeFile(resolve(folder, 'preview.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220"><rect width="320" height="220" fill="#f6f7f4"/><rect x="320" width="320" height="220" fill="#202723"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="48" y="44" width="112" height="112"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="368" y="44" width="112" height="112"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="200" y="70" width="32" height="32"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="248" y="78" width="16" height="16"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="520" y="70" width="32" height="32"/><image href="data:image/svg+xml;base64,${svg.toString('base64')}" x="568" y="78" width="16" height="16"/><text x="50" y="191" font-family="sans-serif" font-size="14" fill="#42604d">AI Inbox · 128 / 32 / 16</text><text x="370" y="191" font-family="sans-serif" font-size="14" fill="#bfd5c5">AI Inbox · 128 / 32 / 16</text></svg>`);
await sharp(await readFile(resolve(folder, 'preview.svg'))).png().toFile(resolve(folder, 'preview.png'));
console.log('Original AI Inbox icons regenerated.');
