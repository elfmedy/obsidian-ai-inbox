const en = {
  starting: 'Starting…', failed: 'Could not start. Check the plugin data and local service ports.',
  ready: 'Local service ready. Save folder: ', connection: 'Browser connection', reset: 'Reset connection',
  folder: 'Save folder', folderDesc: 'Applies to new notes. Existing notes are updated at their current location.', apply: 'Apply',
  folderSaved: 'Save folder updated. Existing notes keep their current location.', folderFailed: 'Could not save this folder. Check the path and try again.',
  resetSaved: 'The old connection is no longer valid. Confirm pairing again in your browser.', resetFailed: 'Connection reset did not finish. Reload the plugin.',
  instructions: 'The browser discovers this vault automatically. Confirm pairing once and keep this vault open while saving.',
  pairTitle: 'Connect AI Inbox', pairVault: 'Allow the browser to save conversations to this vault: ',
  pairDesc: 'Check that the pairing code matches your browser. You only need to confirm once.', cancel: 'Cancel', allow: 'Allow connection',
  language: 'Interface language', languageDesc: 'Applies to plugin settings, dialogs, notices, and generated note labels. Conversation text is not translated.',
  auto: 'Follow Obsidian', thinking: 'Save thinking content',
  thinkingDesc: 'Include the summaries shown when expanding Thinking in ChatGPT, in collapsed callouts. Off by default.',
  title: 'Show conversation title in body', titleDesc: 'Add a heading at the beginning of the note. The filename and headings inside answers are kept either way.',
  nextSave: 'Content settings apply the next time you save. Existing notes are not changed immediately. Local edits remain protected.',
  settingsFailed: 'Could not save settings. Please try again.',
} as const;
type Key = keyof typeof en;
const zh: Record<Key, string> = {
  starting: '正在启动…', failed: '启动失败，请检查数据文件及本地服务端口',
  ready: '已连接本地服务，保存位置：', connection: '浏览器连接', reset: '重置连接',
  folder: '保存文件夹', folderDesc: '只影响新建笔记；已有笔记按当前位置更新。', apply: '应用',
  folderSaved: '新建笔记的保存位置已更新，已有笔记仍在原位置更新', folderFailed: '保存位置无效或设置未能写入，请检查后重试',
  resetSaved: '旧连接已失效，请在浏览器中重新确认配对', resetFailed: '连接重置未完成，请重新加载插件',
  instructions: '浏览器会自动发现本仓库，首次连接时确认一次配对。保存时请保持本仓库打开。',
  pairTitle: '连接 AI Inbox', pairVault: '允许浏览器保存聊天到此仓库：',
  pairDesc: '核对浏览器显示的配对码。确认一次后，无需重复连接。', cancel: '取消', allow: '允许连接',
  language: '界面语言', languageDesc: '用于插件设置、弹窗、提示和笔记自动生成的标签；聊天原文不会被翻译。',
  auto: '跟随 Obsidian', thinking: '保存思考内容',
  thinkingDesc: '保存 ChatGPT 中展开“思考”后显示的摘要，使用默认折叠的引用块。默认关闭。',
  title: '在正文显示对话标题', titleDesc: '在正文开头添加标题。关闭后仍保留文件名和回答中的原有章节标题。',
  nextSave: '内容设置在下次保存时生效，不会立即改动已有笔记。本地编辑仍会受到保护。',
  settingsFailed: '设置未能保存，请重试',
};
export function translate(language: 'zh' | 'en', key: Key): string { return (language === 'zh' ? zh : en)[key]; }
export type TranslationKey = Key;
