import { MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type SettingDefinitionItem } from 'obsidian';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { InboxWriter, type VaultStore } from '../core/writer';
import { startInboxServer } from '../transport/inbox-server';
import { ownedArrayBuffer } from '../assets/binary';
import { ProbeError } from '../shared/errors';
import type { PairPrompt } from '../transport/pairing';

const DataSchema = z.strictObject({ version: z.literal(1), vaultId: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), folder: z.string().default('AI Inbox'), writer: z.unknown() });
type Data = z.infer<typeof DataSchema>;

export default class AiInbox extends Plugin {
  private data: Data | undefined;
  private receiver: Awaited<ReturnType<typeof startInboxServer>> | undefined;
  private disposed = false;
  private writer: InboxWriter | undefined;
  private dataTail: Promise<unknown> = Promise.resolve();
  status = '正在启动';
  get folder() { return this.data?.folder ?? 'AI Inbox'; }
  private updateData(patch: Partial<Data>) {
    const work = this.dataTail.then(async () => {
      if (this.disposed || !this.data) throw new Error('Plugin unavailable');
      const next = { ...this.data, ...patch }; await this.saveData(next); this.data = next;
    });
    this.dataTail = work.catch(() => undefined); return work;
  }
  onload() {
    this.addSettingTab(new InboxSettings(this.app, this));
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) void this.start().catch(() => {
      this.status = '启动失败，请检查数据文件及本地服务端口'; new Notice(this.status);
    }); });
  }
  private async start() {
    const raw: unknown = await this.loadData();
    this.data = raw == null ? { version: 1, vaultId: randomUUID(), token: randomBytes(32).toString('hex'), folder: 'AI Inbox', writer: null } : DataSchema.parse(raw);
    await this.saveData(this.data);
    const ensureFolder = async (path: string) => {
      const parts = path.split('/'); parts.pop(); let current = '';
      for (const part of parts) { current = current ? `${current}/${part}` : part;
        if (!this.app.vault.getFolderByPath(current)) await this.app.vault.createFolder(current);
      }
    };
    const fileAt = (path: string) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file && !(file instanceof TFile)) throw new ProbeError('PATH_EXISTS', 'A folder occupies the path');
      return file;
    };
    const store: VaultStore = {
      read: async path => { const file = fileAt(path); return file ? this.app.vault.read(file) : null; },
      create: async (path, text) => {
        await ensureFolder(path);
        if (this.app.vault.getAbstractFileByPath(path)) throw new ProbeError('PATH_EXISTS', 'Path exists');
        await this.app.vault.create(path, text);
      },
      replace: async (path, expected, text, guard) => {
        const file = fileAt(path); if (!file) throw new ProbeError('REPLAN_REQUIRED', 'File moved');
        await this.app.vault.process(file, current => {
          if (current !== expected || !guard()) throw new ProbeError('REPLAN_REQUIRED', 'Local content changed'); return text;
        });
      },
      editor: path => this.app.workspace.getLeavesOfType('markdown').flatMap(leaf => {
        const view = leaf.view; return view instanceof MarkdownView && view.file?.path === path ? [view.editor.getValue()] : [];
      }),
      markdownPaths: () => this.app.vault.getMarkdownFiles().map(file => file.path),
      readBinary: async path => { const file = fileAt(path); return file ? new Uint8Array(await this.app.vault.readBinary(file)) : null; },
      createBinary: async (path, bytes) => { await ensureFolder(path); await this.app.vault.createBinary(path, ownedArrayBuffer(bytes)); },
      attachmentPath: async (filename, sourcePath) => {
        if (this.app.vault.getFileByPath(sourcePath)) return this.app.fileManager.getAvailablePathForAttachment(filename, sourcePath);
        // Obsidian 1.13 resolves sourcePath only if it names an existing TFile.
        // Use our own short-lived context note in the destination directory;
        // never occupy the user's final note name or follow the active editor.
        await ensureFolder(sourcePath);
        const parent = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
        const sibling = this.app.vault.getMarkdownFiles().find(file => file.path.slice(0, file.path.lastIndexOf('/') + 1) === parent);
        if (sibling) return this.app.fileManager.getAvailablePathForAttachment(filename, sibling.path);
        const contextPath = `${parent}AI Inbox attachment context ${randomUUID()}.md`;
        const marker = `<!-- AI Inbox temporary attachment context ${randomUUID()} -->`;
        const context = await this.app.vault.create(contextPath, marker);
        try { return await this.app.fileManager.getAvailablePathForAttachment(filename, contextPath); }
        finally {
          // If anything outside this operation changes the file, preserve it.
          if (context.path === contextPath && await this.app.vault.read(context) === marker) {
            await this.app.fileManager.trashFile(context);
          }
        }
      },
      saveState: writer => this.updateData({ writer }),
    };
    const writer = new InboxWriter(store, this.data.writer, this.data.folder); this.writer = writer;
    const receiver = await startInboxServer({ writer, token: this.data.token, vaultId: this.data.vaultId, vaultName: this.app.vault.getName(), confirmPair: prompt => this.confirmPair(prompt) });
    if (this.disposed) { await receiver.close(); return; }
    this.receiver = receiver; this.status = `已连接本地服务，保存位置：${this.folder}`;
  }
  private confirmPair(prompt: PairPrompt): Promise<boolean> {
    if (this.disposed || prompt.signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => { new PairingModal(this.app, prompt, resolve).open(); });
  }
  async changeFolder(folder: string) {
    try {
      if (!this.writer) throw new Error('Not ready');
      await this.writer.configureFolder(folder, () => this.updateData({ folder }));
      this.status = `已连接本地服务，保存位置：${folder}`; new Notice('新建笔记的保存位置已更新，已有笔记仍在原位置更新');
    } catch { new Notice('保存位置无效或设置未能写入，请检查后重试'); }
  }
  async resetConnection() {
    try {
      if (!this.writer || !this.data || !this.receiver) throw new Error('Not ready');
      await this.writer.ready(); await this.receiver.close(); this.receiver = undefined;
      await this.updateData({ token: randomBytes(32).toString('hex') });
      this.receiver = await startInboxServer({ writer: this.writer, token: this.data.token, vaultId: this.data.vaultId, vaultName: this.app.vault.getName(), confirmPair: prompt => this.confirmPair(prompt) });
      new Notice('旧连接已失效，请在浏览器中重新确认配对');
    } catch { this.status = '连接重置未完成，请重新加载插件'; new Notice(this.status); }
  }
  onunload() {
    this.disposed = true;
    if (this.receiver) void this.receiver.close().catch(() => undefined);
  }
}
class PairingModal extends Modal {
  private settled = false;
  private abort = () => this.finish(false);
  constructor(app: App, private readonly prompt: PairPrompt, private readonly resolve: (approved: boolean) => void) { super(app); }
  onOpen() {
    if (this.prompt.signal.aborted) { this.finish(false); return; }
    this.prompt.signal.addEventListener('abort', this.abort, { once: true });
    this.setTitle('连接 AI Inbox');
    this.contentEl.createEl('p', { text: `允许浏览器保存聊天到「${this.app.vault.getName()}」？` });
    this.contentEl.createEl('p', { text: '核对浏览器显示的配对码。确认一次后，无需重复连接。' });
    this.contentEl.createEl('h2', { text: this.prompt.code });
    new Setting(this.contentEl).addButton(button => button.setButtonText('取消').onClick(() => this.finish(false)))
      .addButton(button => button.setButtonText('允许连接').setCta().onClick(() => this.finish(true)));
  }
  private finish(approved: boolean) {
    if (this.settled) return; this.settled = true; this.prompt.signal.removeEventListener('abort', this.abort);
    this.resolve(approved); this.close();
  }
  onClose() {
    if (!this.settled) { this.settled = true; this.prompt.signal.removeEventListener('abort', this.abort); this.resolve(false); }
    this.contentEl.empty();
  }
}
class InboxSettings extends PluginSettingTab {
  constructor(app: App, private readonly inbox: AiInbox) { super(app, inbox); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    let folder = this.inbox.folder;
    return [{ name: '浏览器连接', desc: '浏览器会自动发现本仓库，首次连接时在这里确认配对。请保持本仓库打开。',
      render: setting => { setting.setDesc(this.inbox.status)
        .addButton(button => button.setButtonText('重置连接').onClick(() => this.inbox.resetConnection())); },
    }, { name: '保存文件夹', desc: '只影响新建笔记；已有笔记按当前位置更新。', render: setting => {
      setting.addText(text => text.setValue(folder).onChange(value => { folder = value; }))
        .addButton(button => button.setButtonText('应用').onClick(() => this.inbox.changeFolder(folder)));
    } }];
  }
  display() {
    this.containerEl.empty();
    let folder = this.inbox.folder;
    new Setting(this.containerEl).setName('浏览器连接').setDesc(this.inbox.status)
      .addButton(button => button.setButtonText('重置连接').onClick(() => this.inbox.resetConnection()));
    new Setting(this.containerEl).setName('保存文件夹').setDesc('只影响新建笔记；已有笔记按当前位置更新。')
      .addText(text => text.setValue(folder).onChange(value => { folder = value; }))
      .addButton(button => button.setButtonText('应用').onClick(() => this.inbox.changeFolder(folder)));
    this.containerEl.createEl('p', { text: '浏览器会自动发现本仓库，首次连接时确认一次配对。请保持本仓库打开；未运行时保存会失败。' });
  }
}
