import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { randomBytes } from 'node:crypto';
import { decideSave, hash, normalizeBody, replacementIfUnchanged, splitMarkdown } from '../persistence/policy';
import { FIXTURE_HASH, FIXTURE_PNG, startProbeServer } from '../transport/server';
import type { ProbeMetrics } from '../transport/server';
import { ownedArrayBuffer } from '../assets/binary';
import { detectImageType } from '../assets/inspect';

const MARKER = 'AI-INBOX-P0-VAULT.json';
const PLUGIN_ID = 'ai-inbox-p0';

export default class AiInboxProbe extends Plugin {
  private receiver?: Awaited<ReturnType<typeof startProbeServer>>;
  private runFolder = '';
  private disposed = false;
  private initialized = false;

  async onload() {
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      void this.start().catch(() => { if (!this.disposed) new Notice('P0 启动失败；检查 27126 端口是否占用'); });
    });
    this.addCommand({ id: 'open-connection', name: '打开测试连接信息', callback: () => {
      if (this.initialized) void this.app.workspace.openLinkText(`${this.runFolder}/Connection`, '', true);
    } });
    this.addCommand({ id: 'run-editor-probe', name: '验证测试笔记的编辑器保护', callback: () => {
      void this.editorProbe().catch(() => new Notice('P0 编辑器验证未完成，请检查测试结果'));
    } });
  }

  private async start() {
    const markerFile = this.app.vault.getFileByPath(MARKER);
    if (!markerFile) {
      new Notice('AI Inbox P0 仅可在专用测试仓库运行'); return;
    }
    const marker = JSON.parse(await this.app.vault.read(markerFile)) as { purpose?: string; vaultId?: string };
    if (marker.purpose !== 'ai-inbox-p0-isolated-tests' || !marker.vaultId) return;
    const token = randomBytes(32).toString('hex');
    this.runFolder = `P0/run-${Date.now()}-${randomBytes(3).toString('hex')}`;
    if (!this.disposed) await this.initialize(marker.vaultId, token);
  }

  async initialize(vaultId: string, token: string) {
    if (!this.app.vault.getFolderByPath('P0')) await this.app.vault.createFolder('P0');
    await this.app.vault.createFolder(this.runFolder);
    await this.persistenceProbe();
    if (this.disposed) return;
    const receiver = await startProbeServer({ token, vaultId, port: 27126,
      onReport: metrics => this.recordBrowser(metrics),
      onContentImage: (bytes, sha256) => this.storeContentImage(bytes, sha256),
      onImage: async bytes => {
        const path = `${this.runFolder}/transport-fixture.png`;
        let file = this.app.vault.getAbstractFileByPath(path);
        file ??= await this.app.vault.createBinary(path, ownedArrayBuffer(bytes));
        if (!(file instanceof TFile)) throw new Error('Expected image file');
        const roundtrip = new Uint8Array(await this.app.vault.readBinary(file));
        if (hash(roundtrip) !== FIXTURE_HASH) throw new Error('Image roundtrip failed');
      },
    });
    if (this.disposed) { await receiver.close(); return; }
    this.receiver = receiver;
    await this.app.vault.create(`${this.runFolder}/Connection.md`,
      '# P0 测试连接\n\n只用于此测试仓库。重载插件后令牌失效，请使用最新 run 目录。\n\n```json\n' +
      JSON.stringify({ endpoint: `http://127.0.0.1:${this.receiver.port}/`, vaultId, token }) + '\n```\n');
    this.initialized = true;
    if (!this.disposed) new Notice('AI Inbox P0 已就绪，命令面板可打开测试连接信息');
  }

  private async storeContentImage(bytes: Uint8Array, sha256: string) {
    if (this.disposed || hash(bytes) !== sha256) throw new Error('Image input invalid');
    const mime = detectImageType(bytes);
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
    const directory = `${this.runFolder}/content-images`;
    if (!this.app.vault.getFolderByPath(directory)) await this.app.vault.createFolder(directory);
    const path = `${directory}/${sha256}.${extension}`;
    let file = this.app.vault.getAbstractFileByPath(path);
    file ??= await this.app.vault.createBinary(path, ownedArrayBuffer(bytes));
    if (!(file instanceof TFile)) throw new Error('Image path is not a file');
    const readback = new Uint8Array(await this.app.vault.readBinary(file));
    // Idempotent re-upload never overwrites an existing or user-modified asset.
    if (hash(readback) !== sha256 || readback.length !== bytes.length) throw new Error('Image readback differs');
    const previewPath = `${directory}/${sha256}.md`;
    if (!this.app.vault.getAbstractFileByPath(previewPath)) {
      await this.app.vault.create(previewPath, '# P0 真实图片验证\n\n此图片从浏览器下载后传入，已校验写入前后字节一致。\n\n' +
        '可断网后打开此预览，确认图片仍能显示。这里只保存测试图片，不是完整聊天笔记。\n\n' +
        `![[${path}]]\n`);
    }
    const reportPath = `${directory}/${sha256}.json`;
    if (!this.app.vault.getAbstractFileByPath(reportPath)) {
      await this.app.vault.create(reportPath, JSON.stringify({ kind: 'content-image-readback',
        at: new Date().toISOString(), sha256, byteLength: readback.length, mime,
        readbackVerified: true, offlineDisplayVerified: false, productionReady: false }, null, 2));
    }
    return { path, previewPath, sha256, byteLength: bytes.length, mime };
  }

  private async persistenceProbe() {
    const before = '---\ntags: [测试]\n# 保留注释\n---\n\n# 测试聊天\n\n旧正文。\n';
    const body = '\n# 测试聊天\n\n新正文。\n';
    const file = await this.app.vault.create(`${this.runFolder}/Protected.md`, before);
    await this.app.vault.process(file, current => replacementIfUnchanged(current, before, body));
    const updated = await this.app.vault.read(file);
    const propertiesPreserved = updated === splitMarkdown(before).prefix + body;
    const edited = `${updated}\n用户新编辑。\n`;
    await this.app.vault.modify(file, edited);
    let raceRejected = false;
    try {
      await this.app.vault.process(file, current => replacementIfUnchanged(current, updated, '不应覆盖'));
    } catch { raceRejected = true; }
    const userEditPreserved = (await this.app.vault.read(file)) === edited;
    const action = decideSave({ trustedTarget: true, localBody: splitMarkdown(edited).body,
      baselineBodyHash: hash(normalizeBody(body)), previousSourceHash: 'same', sourceHash: 'same' });
    const image = await this.app.vault.createBinary(`${this.runFolder}/fixture.png`, ownedArrayBuffer(FIXTURE_PNG));
    const imageRoundtrip = hash(new Uint8Array(await this.app.vault.readBinary(image))) === FIXTURE_HASH;
    const report = { kind: 'real-obsidian-vault-api', at: new Date().toISOString(),
      propertiesPreserved, raceRejected, userEditPreserved, localEditedSourceSameForks: action === 'forked', imageRoundtrip,
      editorBufferVerified: false, fullP0Passed: false };
    await this.app.vault.create(`${this.runFolder}/vault-results.json`, JSON.stringify(report, null, 2));
    await this.app.vault.create(`${this.runFolder}/Image-preview.md`, '# 本地图片验收\n\n断网后应仍能看到图片（1×1 像素测试图）。\n\n' +
      `![[${image.path}]]\n`);
  }

  private async editorProbe() {
    if (this.disposed || !this.initialized) throw new Error('Not ready');
    const path = `${this.runFolder}/Editor-${Date.now()}.md`;
    const generated = '# 编辑器保护测试\n\n原始内容。\n';
    const edited = `${generated}\n来自编辑器的新增内容。\n`;
    const file = await this.app.vault.create(path, generated);
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    if (!(leaf.view instanceof MarkdownView)) throw new Error('Markdown editor unavailable');
    leaf.view.editor.setValue(edited);
    const disk = await this.app.vault.read(file);
    const buffer = leaf.view.editor.getValue();
    const action = decideSave({ trustedTarget: true, localBody: splitMarkdown(buffer).body,
      baselineBodyHash: hash(normalizeBody(generated)), previousSourceHash: 'same', sourceHash: 'same' });
    if (action !== 'forked') throw new Error('Dirty editor was not protected');
    const imported = await this.app.vault.create(`${path.slice(0, -3)}-imported.md`, generated);
    const report = { kind: 'real-obsidian-editor', at: new Date().toISOString(),
      diskDifferedFromEditorAtRead: disk !== buffer, action,
      bufferPreserved: leaf.view.editor.getValue() === edited,
      newFileContainsSource: (await this.app.vault.read(imported)) === generated,
      fullP0Passed: false };
    await this.app.vault.create(`${path.slice(0, -3)}-results.json`, JSON.stringify(report, null, 2));
    new Notice('P0 编辑器结果已记录');
  }

  private async recordBrowser(metrics: ProbeMetrics) {
    await this.app.vault.create(`${this.runFolder}/browser-${Date.now()}-${randomBytes(3).toString('hex')}.json`,
      JSON.stringify({ ...metrics, at: new Date().toISOString(), productionReady: false }, null, 2));
  }

  onunload() {
    this.disposed = true;
    this.initialized = false;
    void this.receiver?.close().catch(() => undefined);
  }
}

export { PLUGIN_ID };
