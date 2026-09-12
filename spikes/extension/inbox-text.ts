import type { Feedback } from './inbox-types';
const errors: Record<string, [string, string]> = {
  OBSIDIAN_UNAVAILABLE: ['无法连接 Obsidian。请先打开目标仓库并启用 AI Inbox，再重新保存。', 'Cannot connect to Obsidian. Open the target vault and enable AI Inbox, then save again.'],
  DEFAULT_VAULT_UNAVAILABLE: ['默认仓库未运行或 AI Inbox 未启用，本次保存失败。打开默认仓库后重试，或右键扩展图标切换仓库。', 'The default vault is unavailable. Open it and enable AI Inbox, or right-click the extension to switch vaults.'],
  VAULT_SELECTION_REQUIRED: ['已发现多个仓库，请选择保存到哪个仓库。选择后它将成为默认仓库。', 'Multiple vaults found. Select a destination; it becomes your default vault.'],
  VAULT_ID_AMBIGUOUS: ['多个运行中的仓库使用了相同身份，请检查复制的插件数据后重试。', 'Multiple running vaults share one identity. Check copied plugin data before retrying.'],
  PAIRING_BUSY: ['另一项连接确认正在进行，请完成后再试。', 'Another connection is in progress. Complete it before retrying.'],
  PAIRING_REJECTED: ['连接已取消，未保存聊天。需要时再次点击保存。', 'Connection cancelled. The chat was not saved. Click Save to try again.'],
  PAIRING_EXPIRED: ['连接确认已超时，请再次点击保存重新配对。', 'Pairing timed out. Click Save to pair again.'],
  PAIRING_UNAVAILABLE: ['请更新并重新启用 Obsidian 中的 AI Inbox 插件，再尝试连接。', 'Update and re-enable AI Inbox in Obsidian, then connect again.'],
  CURRENT_CHAT_MESSAGE_ARRAY_UNVERIFIED: ['聊天消息未通过完整校验，本次未提交笔记。请复制诊断。', 'Conversation validation failed. No note was submitted. Copy diagnostics.'],
  ATTACHMENT_INVALID: ['附件信息格式暂不兼容，本次未提交笔记。请复制诊断。', 'Attachment metadata is not supported. No note was submitted. Copy diagnostics.'],
  CITATION_INVALID: ['引用信息格式暂不兼容，本次未提交笔记。请复制诊断。', 'Citation metadata is not supported. No note was submitted. Copy diagnostics.'],
  CITATION_URL_INVALID: ['引用地址格式暂不兼容，本次未提交笔记。请复制诊断。', 'A citation address is not supported. No note was submitted. Copy diagnostics.'],
  MESSAGE_ARRAY_PAGINATION_UNKNOWN: ['无法确认聊天历史是否完整，本次未提交笔记。请复制诊断。', 'Full conversation coverage could not be confirmed. No note was submitted. Copy diagnostics.'],
  MESSAGE_ARRAY_PARTIAL: ['接口返回了部分聊天历史，本次未提交笔记。请复制诊断。', 'The API returned partial history. No note was submitted. Copy diagnostics.'],
  CONVERSATION_BUSY: ['此聊天正在另一个标签页保存，请等待完成。', 'This conversation is being saved in another tab. Wait for it to finish.'],
  PENDING_CHAT_MISMATCH: ['此标签页有另一份待确认的保存。请在新标签页打开当前聊天后保存。', 'This tab has another unfinished save. Open this conversation in a new tab to save.'],
  UNSUPPORTED_PAGE: ['请打开 ChatGPT 普通聊天后再保存。', 'Open an ordinary ChatGPT conversation to save.'],
  CONNECTION_REQUIRED: ['请先在扩展设置中连接 Obsidian。', 'Connect Obsidian in extension settings first.'],
  CONNECTION_INVALID: ['连接信息无效，请在扩展设置中重新选择仓库配对。', 'Select the vault in extension settings to pair again.'],
  UNAUTHORIZED: ['连接已失效，请在扩展设置中重新选择仓库配对。', 'Connection expired. Select the vault in settings to pair again.'],
  CURRENT_CHAT_REQUEST_NOT_OBSERVED: ['请刷新此聊天页面，等待加载完成后再点击保存。', 'Reload this chat, wait until loaded, then save again.'],
  EXPORT_SETTINGS_CHANGED: ['Obsidian 的保存设置已变化，本次未写入笔记。请再次点击保存。', 'Obsidian export settings changed. No note was written. Click Save again.'],
  PLUGIN_UPDATE_REQUIRED: ['请将 Obsidian 的 AI Inbox 插件更新至 0.3.0 或更新版本。', 'Update the AI Inbox Obsidian plugin to 0.3.0 or later.'],
  EXTENSION_UPDATE_REQUIRED: ['请更新 Chrome 扩展后重新保存，以应用思考内容设置。', 'Update the Chrome extension and save again to apply thinking settings.'],
  THINKING_FORMAT_UNSUPPORTED: ['当前思考内容格式暂不支持，本次未提交笔记。可关闭保存思考后重试。', 'This thinking format is unsupported. No note was submitted. Turn off thinking export to retry.'],
  SOURCE_GENERATING: ['请等待 ChatGPT 回复完成后再保存。', 'Wait until ChatGPT finishes replying.'],
  SOURCE_CHANGED: ['保存准备过程中聊天发生变化，请重新点击保存。', 'The conversation changed. Click Save again.'],
  VISIBLE_CHAIN_NOT_CONFIRMED: ['无法确认当前分支。请刷新聊天并等待加载完成后重试。', 'Could not verify the selected branch. Reload the chat and retry.'],
  REVISION_CONFLICT: ['其他保存已完成，请再次点击保存以读取最新状态。', 'Another save completed. Click Save again to use the latest state.'],
  REPLAN_REQUIRED: ['本地笔记在写入前发生变化，内容已保护。请再次点击保存。', 'The local note changed before writing and was protected. Click Save again.'],
  PENDING_VAULT_MISMATCH: ['有一份待确认的保存属于另一个仓库，请先连接原仓库完成确认。', 'An unfinished save belongs to another vault. Reconnect that vault to resolve it.'],
  RECOVERY_CONFLICT: ['中断后的笔记又发生了变化，已保留现有内容。请保留数据并反馈此错误。', 'The note changed after an interrupted save. Existing content was preserved; report this error.'],
  CITATION_REQUIRES_ADAPTER: ['当前回复包含暂不支持的引用格式，未提交笔记。请反馈此错误。', 'This reply has an unsupported citation format. No note was submitted. Please report it.'],
  HTML_CONTENT_REQUIRES_ADAPTER: ['当前聊天包含暂不支持的 HTML 内容，未提交笔记。', 'This chat contains unsupported HTML content. No note was submitted.'],
  IMAGE_REFERENCE_UNSUPPORTED: ['当前聊天包含暂不支持的图片地址，未提交笔记。', 'An image address is unsupported. No note was submitted.'],
  IMAGE_RESOLVER_HTTP_FAILED: ['图片下载地址获取失败，未提交笔记。请稍后重试。', 'Could not resolve an image download. No note was submitted. Retry later.'],
  ASSET_FETCH_FAILED: ['图片下载失败，未提交笔记。请稍后重试。', 'An image download failed. No note was submitted. Retry later.'],
  IMAGE_MIME_MISMATCH: ['图片数据与声明的格式不一致，未提交笔记。', 'Image data does not match its declared format. No note was submitted.'],
  LIMIT_EXCEEDED: ['当前聊天超过安全处理上限，未完成保存。', 'This chat exceeds a processing limit. Save did not complete.'],
};
export function feedbackText(data: Feedback, zh: boolean): string {
  if (data.stage === 'pairing') return zh ? `请在 Obsidian 中确认连接「${data.vaultName ?? ''}」。\n配对码：${data.pairCode ?? ''}`
    : `Confirm the connection to “${data.vaultName ?? ''}” in Obsidian.\nPairing code: ${data.pairCode ?? ''}`;
  if (data.stage === 'error') return errors[data.code ?? '']?.[zh ? 0 : 1] ?? (data.notSubmitted ? (zh
    ? '读取聊天失败，本次未提交笔记。请复制诊断，便于定位失败字段。'
    : 'Reading the conversation failed. No note was submitted. Copy diagnostics to identify the failing fields.') : zh
    ? '保存结果尚未确认。请保持 Obsidian 打开，再次点击扩展图标重试；已有待提交记录时会先核对结果。'
    : 'Save is not confirmed. Keep Obsidian open and click the icon again. Pending requests are checked before retrying.');
  if (data.stage === 'success' && data.receipt) {
    const actions = zh ? { created: '已保存', updated: '已更新', unchanged: '内容未变化', forked: '本地修改已保留，另存了新笔记' }
      : { created: 'Saved', updated: 'Updated', unchanged: 'No changes', forked: 'Local edits preserved; saved a new note' };
    return `${actions[data.receipt.action]}\n${data.receipt.path}\n${data.receipt.messages} ${zh ? '条消息' : 'messages'} · ${data.receipt.images} ${zh ? '张图片' : 'images'}`;
  }
  const stages = zh ? { connecting: '正在连接 Obsidian…', reading: '正在读取完整聊天…', images: '正在下载图片', checking: '正在确认聊天内容没有变化…', transferring: '正在传输图片', saving: '正在保存笔记…', recovering: '正在核对上次保存结果…', success: '已完成', error: '' }
    : { connecting: 'Connecting to Obsidian…', reading: 'Reading the full conversation…', images: 'Downloading images', checking: 'Checking the conversation has not changed…', transferring: 'Transferring images', saving: 'Saving the note…', recovering: 'Checking the previous save…', success: 'Done', error: '' };
  return stages[data.stage] + (data.total !== undefined ? ` (${data.count ?? 0}/${data.total})` : '');
}
