/** Chrome create() returns an ID before creation completes. Use callbacks for
 * both mutations (also compatible with Chrome 120), and serialize the entire
 * rebuild across installation, startup, and preference-change events. */
function completed(resolve: () => void, reject: (error: Error) => void) {
  const error = chrome.runtime.lastError;
  if (error) reject(new Error(error.message ?? 'Context menu operation failed'));
  else resolve();
}
async function rebuild() {
  const stored = await chrome.storage.local.get('preferences');
  const prefs = stored.preferences as { language?: string; contextMenu?: boolean } | undefined;
  const zh = prefs?.language === 'zh' || (prefs?.language !== 'en' && chrome.i18n.getUILanguage().startsWith('zh'));
  await new Promise<void>((resolve, reject) => { chrome.contextMenus.removeAll(() => completed(resolve, reject)); });
  const items: chrome.contextMenus.CreateProperties[] = [
    { id: 'settings', title: zh ? '切换仓库 / 设置' : 'Switch vault / Settings', contexts: ['action'] },
    { id: 'status', title: zh ? '最近保存状态' : 'Last save status', contexts: ['action'] },
  ];
  if (prefs?.contextMenu !== false) items.push({ id: 'save', title: zh ? '保存当前聊天到 Obsidian' : 'Save current chat to Obsidian',
    contexts: ['page'], documentUrlPatterns: ['https://chatgpt.com/c/*'] });
  for (const item of items) await new Promise<void>((resolve, reject) => {
    chrome.contextMenus.create(item, () => completed(resolve, reject));
  });
}
export function createMenuUpdater() {
  let tail = Promise.resolve();
  return () => {
    const work = tail.then(rebuild);
    // A failed attempt must not prevent a later event from repairing the menu.
    tail = work.catch(() => undefined);
    return work;
  };
}
