import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include full license text for pinned runtime dependencies.
const root = resolve(import.meta.dirname, '..');
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const notices = ['# Pinned npm dependency licenses', '',
  'Generated from package-lock.json; original authors retain copyright.',
  ''];
for (const [directory, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!directory.startsWith('node_modules/') || entry.dev) continue;
  const files = await readdir(resolve(root, directory), { withFileTypes: true });
  const licenses = files.filter(file => file.isFile() && /^(?:licen[cs]e|copying)(?:\..*)?$/i.test(file.name));
  if (!licenses.length) throw new Error(`Missing dependency license: ${directory}`);
  const manifest = JSON.parse(await readFile(resolve(root, directory, 'package.json'), 'utf8'));
  notices.push(`## ${manifest.name}@${entry.version}`, '', `License: ${entry.license ?? manifest.license}`, '');
  for (const file of licenses.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    notices.push(await readFile(resolve(root, directory, file.name), 'utf8'), '');
  }
}
await writeFile(resolve(root, 'third-party/npm-dependencies.txt'), notices.join('\n').trimEnd() + '\n');
