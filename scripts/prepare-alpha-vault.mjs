import { readFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..'); const vault = resolve(root, '.local/p0-vault');
const marker = JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8'));
if (marker.purpose !== 'ai-inbox-p0-isolated-tests') throw new Error('Only the marked test vault may be updated');
await cp(resolve(root, 'dist/alpha/obsidian-plugin'), join(vault, '.obsidian/plugins/ai-inbox'), { recursive: true });
console.log('Alpha plugin installed in the isolated p0-vault. Existing plugin settings and P0 files were preserved.');
