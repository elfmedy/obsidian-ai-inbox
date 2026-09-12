import { mkdir, writeFile, readFile, cp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const vault = resolve(root, '.local/p0-vault');
const markerPath = join(vault, 'AI-INBOX-P0-VAULT.json');
async function exists(path) { try { await access(path); return true; } catch { return false; } }
if (await exists(vault)) {
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.purpose !== 'ai-inbox-p0-isolated-tests') throw new Error('Refusing to modify a non-test vault');
} else {
  await mkdir(vault, { recursive: true });
  await writeFile(markerPath, JSON.stringify({ purpose: 'ai-inbox-p0-isolated-tests', vaultId: randomUUID() }, null, 2));
}
await mkdir(join(vault, '.obsidian/plugins'), { recursive: true });
await cp(resolve(root, 'dist/p0/obsidian-plugin'), join(vault, '.obsidian/plugins/ai-inbox-p0'), { recursive: true });
// User enables the local test plugin in this test vault. Do not change app trust settings.
if (!(await exists(join(vault, 'START-HERE.md')))) {
  await writeFile(join(vault, 'START-HERE.md'), '# AI Inbox P0 测试仓库\n\n只包含自动生成的测试内容。\n\n' +
    '启用 AI Inbox P0 后会建立新的 P0/run-* 目录并执行 Vault API 验证。\n\n' +
    '命令面板：AI Inbox P0: 打开测试连接信息；AI Inbox P0: 验证测试笔记的编辑器保护。\n\n' +
    '这不是正式导入器。测试通过前不会标记 P0 完成。\n');
}
console.log(`Prepared isolated test vault: ${vault}`);
console.log('No regular vault or application trust settings were modified.');
