import { ContentSettings, resolveLanguage, type ContentSettingsData } from '../shared/export-options';
import { translate, type TranslationKey } from './i18n';
import { getLanguage, requireApiVersion, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from 'obsidian';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { InboxWriter, type VaultStore } from '../core/writer';
import { startInboxServer } from '../transport/inbox-server';
import { ownedArrayBuffer } from '../assets/binary';
import { ProbeError } from '../shared/errors';
import type { PairPrompt } from '../transport/pairing';

const DataSchema = z.strictObject({ version: z.literal(1), vaultId: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), folder: z.string().default('AI Inbox'), ...ContentSettings.shape, writer: z.unknown() });
type Data = z.infer<typeof DataSchema>;

export default class AiInbox extends Plugin {
  private data: Data | undefined;
  private settingsTab: InboxSettings | undefined;
  private receiver: Awaited<ReturnType<typeof startInboxServer>> | undefined;
  private disposed = false;
  private writer: InboxWriter | undefined;
  private dataTail: Promise<unknown> = Promise.resolve();
  private serviceState: 'starting' | 'ready' | 'failed' | 'resetFailed' = 'starting';
  get contentSettings(): ContentSettingsData { return ContentSettings.parse(this.data ? { includeThinking: this.data.includeThinking, includeTitle: this.data.includeTitle, language: this.data.language } : {}); }
  get language() { return resolveLanguage(this.contentSettings.language, getLanguage()); }
  t(key: TranslationKey) { return translate(this.language, key); }
  get status() { return this.serviceState === 'ready' ? this.t('ready') + this.folder : this.t(this.serviceState); }
  async changeSettings(patch: Partial<ContentSettingsData>) {
    try { ContentSettings.parse({ ...this.contentSettings, ...patch }); await this.updateData(patch); this.settingsTab?.refreshSettings(); return true; }
    catch { new Notice(this.t('settingsFailed')); return false; }
  }
  get folder() { return this.data?.folder ?? 'AI Inbox'; }
  private updateData(patch: Partial<Data>) {
    const work = this.dataTail.then(async () => {
      if (this.disposed || !this.data) throw new Error('Plugin unavailable');
      const next = { ...this.data, ...patch }; await this.saveData(next); this.data = next;
    });
    this.dataTail = work.catch(() => undefined); return work;
  }
  onload() {
    this.settingsTab = new InboxSettings(this.app, this); this.addSettingTab(this.settingsTab);
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) void this.start().catch(() => {
      this.serviceState = 'failed'; this.settingsTab?.refreshSettings(); new Notice(this.status);
    }); });
  }
  private async start() {
    const raw: unknown = await this.loadData();
    this.data = raw == null ? { version: 1, vaultId: randomUUID(), token: randomBytes(32).toString('hex'), folder: 'AI Inbox', ...ContentSettings.parse({}), writer: null } : DataSchema.parse(raw);
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
    const writer = new InboxWriter(store, this.data.writer, this.data.folder, () => ({ includeThinking: this.contentSettings.includeThinking, includeTitle: this.contentSettings.includeTitle, language: this.language })); this.writer = writer;
    const receiver = await startInboxServer({ writer, token: this.data.token, vaultId: this.data.vaultId, vaultName: this.app.vault.getName(), confirmPair: prompt => this.confirmPair(prompt) });
    if (this.disposed) { await receiver.close(); return; }
    this.receiver = receiver; this.serviceState = 'ready'; this.settingsTab?.refreshSettings();
  }
  private confirmPair(prompt: PairPrompt): Promise<boolean> {
    if (this.disposed || prompt.signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => { new PairingModal(this.app, prompt, resolve, key => this.t(key)).open(); });
  }
  async changeFolder(folder: string) {
    try {
      if (!this.writer) throw new Error('Not ready');
      await this.writer.configureFolder(folder, () => this.updateData({ folder }));
      this.serviceState = 'ready'; this.settingsTab?.refreshSettings(); new Notice(this.t('folderSaved'));
    } catch { new Notice(this.t('folderFailed')); }
  }
  async resetConnection() {
    try {
      if (!this.writer || !this.data || !this.receiver) throw new Error('Not ready');
      await this.writer.ready(); await this.receiver.close(); this.receiver = undefined;
      await this.updateData({ token: randomBytes(32).toString('hex') });
      this.receiver = await startInboxServer({ writer: this.writer, token: this.data.token, vaultId: this.data.vaultId, vaultName: this.app.vault.getName(), confirmPair: prompt => this.confirmPair(prompt) });
      new Notice(this.t('resetSaved'));
    } catch { this.serviceState = 'resetFailed'; this.settingsTab?.refreshSettings(); new Notice(this.status); }
  }
  onunload() {
    this.disposed = true;
    if (this.receiver) void this.receiver.close().catch(() => undefined);
  }
}
class PairingModal extends Modal {
  private settled = false;
  private abort = () => this.finish(false);
  constructor(app: App, private readonly prompt: PairPrompt, private readonly resolve: (approved: boolean) => void, private readonly t: (key: TranslationKey) => string) { super(app); }
  onOpen() {
    if (this.prompt.signal.aborted) { this.finish(false); return; }
    this.prompt.signal.addEventListener('abort', this.abort, { once: true });
    this.setTitle(this.t('pairTitle'));
    this.contentEl.createEl('p', { text: this.t('pairVault') + this.app.vault.getName() });
    this.contentEl.createEl('p', { text: this.t('pairDesc') });
    this.contentEl.createEl('h2', { text: this.prompt.code });
    new Setting(this.contentEl).addButton(button => button.setButtonText(this.t('cancel')).onClick(() => this.finish(false)))
      .addButton(button => button.setButtonText(this.t('allow')).setCta().onClick(() => this.finish(true)));
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
  getSettingDefinitions(): Array<{ name: string; desc: string; render: (setting: Setting) => void }> {
    const t = (key: TranslationKey) => this.inbox.t(key);
    let folder = this.inbox.folder;
    return [
      { name: t('language'), desc: t('languageDesc'), render: setting => {
        setting.addDropdown(dropdown => dropdown.addOption('auto', t('auto')).addOption('zh', '简体中文').addOption('en', 'English')
          .setValue(this.inbox.contentSettings.language).onChange(async value => {
            if (value === 'auto' || value === 'zh' || value === 'en') { await this.inbox.changeSettings({ language: value }); this.refreshSettings(); }
          }));
      } },
      { name: t('thinking'), desc: t('thinkingDesc') + ' ' + t('nextSave'), render: setting => {
        setting.addToggle(toggle => toggle.setValue(this.inbox.contentSettings.includeThinking).onChange(async value => {
          await this.inbox.changeSettings({ includeThinking: value }); this.refreshSettings();
        }));
      } },
      { name: t('title'), desc: t('titleDesc'), render: setting => {
        setting.addToggle(toggle => toggle.setValue(this.inbox.contentSettings.includeTitle).onChange(async value => {
          await this.inbox.changeSettings({ includeTitle: value }); this.refreshSettings();
        }));
      } },
      { name: t('connection'), desc: this.inbox.status + ' ' + t('instructions'), render: setting => {
        setting.addButton(button => button.setButtonText(t('reset')).onClick(() => this.inbox.resetConnection()));
      } },
      { name: t('folder'), desc: t('folderDesc'), render: setting => {
        setting.addText(text => text.setValue(folder).onChange(value => { folder = value; }))
          .addButton(button => button.setButtonText(t('apply')).onClick(async () => { await this.inbox.changeFolder(folder); this.refreshSettings(); }));
      } },
    ];
  }
  refreshSettings() {
    if (requireApiVersion('1.13.0')) this.update();
    else this.renderLegacy();
  }
  display() { this.renderLegacy(); }
  private renderLegacy() {
    this.containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      if (!('name' in definition)) continue;
      const setting = new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc ?? '');
      definition.render?.(setting);
    }
    this.containerEl.createEl('p', { text: this.inbox.t('nextSave') });
    this.containerEl.createEl('p', { text: this.inbox.t('instructions') });
  }
}
