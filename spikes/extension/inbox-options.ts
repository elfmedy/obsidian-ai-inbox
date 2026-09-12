import { z } from 'zod';
import type { Preferences } from './inbox-types';
import { feedbackText } from './inbox-text';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const language = element<HTMLSelectElement>('language'); const context = element<HTMLInputElement>('context');
const Overview = z.object({ ok: z.literal(true), defaultId: z.string().nullable(), defaultName: z.string(),
  vaults: z.array(z.object({ vaultId: z.string(), vaultName: z.string(), paired: z.boolean() })) });
const Failure = z.object({ ok: z.literal(false), code: z.string() });
let overview: z.infer<typeof Overview> | undefined; let busy = false; let zh = true;
let result: { kind: 'connected'; name: string } | { kind: 'error'; code: string } | { kind: 'pairing'; code: string; name: string } | undefined;
function translate() {
  zh = language.value === 'zh' || (language.value !== 'en' && chrome.i18n.getUILanguage().startsWith('zh'));
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const text: Record<string, [string, string]> = {
    heading: ['聊天，归入你的笔记。', 'Your conversations, at home.'], intro: ['选择一个运行中的 Obsidian 仓库。首次连接只需确认一次。', 'Choose a running Obsidian vault. Confirm once to connect.'],
    'default-label': ['默认保存到', 'DEFAULT DESTINATION'], 'available-label': ['可用仓库', 'Available vaults'], refresh: ['刷新', 'Refresh'],
    'language-label': ['语言', 'Language'], 'context-label': ['在聊天页面右键菜单中显示保存', 'Show Save in the chat page context menu'],
    hint: ['选择其他仓库后，它就成为默认。日常点击工具栏图标即可保存。', 'Choosing a vault makes it your default. Click the toolbar icon to save.'],
    'shortcut-hint': ['请保持目标仓库打开。快捷键可在 Chrome 扩展的「键盘快捷键」中设置。', 'Keep the target vault open. Set an optional shortcut in Chrome Extensions → Keyboard shortcuts.'],
    'status-link': ['最近保存状态', 'Last save status'],
  };
  for (const [id, values] of Object.entries(text)) element(id).textContent = values[zh ? 0 : 1];
  element('current-vault').textContent = overview?.defaultName || (overview?.defaultId ? (zh ? '已连接的仓库' : 'Connected vault') : (zh ? '尚未选择' : 'No vault selected'));
  const defaultId = overview?.defaultId; const online = overview?.vaults.some(vault => vault.vaultId === defaultId);
  element('availability').textContent = overview?.defaultId ? (online ? (zh ? '可接收当前聊天' : 'Ready to receive your conversation') : (zh ? '当前不可用，请打开此仓库' : 'Unavailable. Open this vault to save.'))
    : (zh ? '首次选择后自动记住' : 'Your first selection will be remembered');
  const list = element('vault-list'); list.replaceChildren();
  for (const vault of overview?.vaults ?? []) {
    const button = document.createElement('button'); button.className = 'vault-option'; button.dataset.vaultId = vault.vaultId;
    const selected = vault.vaultId === overview?.defaultId; button.setAttribute('aria-pressed', String(selected)); button.disabled = busy;
    const name = document.createElement('span'); name.textContent = vault.vaultName;
    const state = document.createElement('small'); state.textContent = selected ? (zh ? '默认 ✓' : 'Default ✓') : vault.paired ? (zh ? '切换到此仓库' : 'Use this vault') : (zh ? '连接此仓库' : 'Connect');
    button.append(name, state); button.onclick = () => { void select(vault.vaultId); }; list.append(button);
  }
  if (overview && !overview.vaults.length) { const empty = document.createElement('p'); empty.className = 'secondary';
    empty.textContent = zh ? '未发现可用仓库。请打开 Obsidian，并启用 AI Inbox 插件。' : 'No vault found. Open Obsidian and enable the AI Inbox plugin.'; list.append(empty); }
  element<HTMLButtonElement>('refresh').disabled = busy;
  element('result').textContent = !result ? '' : result.kind === 'connected' ? (zh ? `已设为默认：${result.name}。返回聊天即可保存。` : `Default vault: ${result.name}. Return to your chat to save.`)
    : result.kind === 'pairing' ? feedbackText({ stage: 'pairing', pairCode: result.code, vaultName: result.name }, zh) : feedbackText({ stage: 'error', code: result.code }, zh);
}
async function refresh() {
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'vault-overview' });
    const error = Failure.safeParse(response); if (error.success) result = { kind: 'error', code: error.data.code };
    else overview = Overview.parse(response);
  } catch { result = { kind: 'error', code: 'OBSIDIAN_UNAVAILABLE' }; }
  translate();
}
async function select(vaultId: string) {
  if (busy) return; busy = true; result = undefined; translate();
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: 'select-vault', vaultId });
    const error = Failure.safeParse(response);
    result = error.success ? { kind: 'error', code: error.data.code } : { kind: 'connected', name: z.object({ ok: z.literal(true), vaultName: z.string() }).parse(response).vaultName };
  } catch { result = { kind: 'error', code: 'OBSIDIAN_UNAVAILABLE' }; }
  finally { busy = false; await refresh(); }
}
void chrome.storage.local.get('preferences').then(async stored => {
  const prefs = stored.preferences as Preferences | undefined; language.value = prefs?.language ?? 'auto'; context.checked = prefs?.contextMenu !== false;
  translate(); await refresh();
});
language.onchange = context.onchange = () => {
  const preferences: Preferences = { language: language.value as Preferences['language'], contextMenu: context.checked };
  void chrome.storage.local.set({ preferences }); translate();
};
element<HTMLButtonElement>('refresh').onclick = () => { result = undefined; void refresh(); };
chrome.storage.onChanged.addListener(changes => {
  if (changes.pairingStatus && !changes.pairingStatus.newValue && result?.kind === 'pairing') { result = undefined; translate(); }
  if (changes.pairingStatus?.newValue) { const value = z.object({ code: z.string(), vaultName: z.string() }).safeParse(changes.pairingStatus.newValue);
    if (value.success) { result = { kind: 'pairing', code: value.data.code, name: value.data.vaultName }; translate(); } }
  if (changes.connection) void refresh();
});
