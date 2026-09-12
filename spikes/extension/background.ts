import './page-probe-types';
import type { PageProbeResult } from './page-probe-types';
import { transferPageImages } from './image-transfer';

interface Connection { endpoint: string; token: string; vaultId: string; }
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let probing = false;
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  const command = message as { type?: string; connection?: string };
  if (probing) { respond({ ok: false, error: '验证仍在进行，请稍候查看结果；没有启动重复任务。' }); return false; }
  if (command.type === 'probe') probing = true;
  let stage = '读取连接配置';
  let latestResult: PageProbeResult | undefined;
  void (async () => {
    await ready;
    if (command.type === 'connect') {
      stage = '连接测试仓库';
      const raw = JSON.parse(command.connection ?? '') as Connection;
      const url = new URL(raw.endpoint);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' ||
          url.search || url.hash || url.username || url.password ||
          !/^[a-f0-9]{64}$/.test(raw.token) || !/^[a-zA-Z0-9-]+$/.test(raw.vaultId)) throw new Error('连接信息无效');
      const response = await fetch(`${url.origin}/v1/hello`, { headers: headers(raw), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('连接被拒绝');
      const info = await response.json() as { vaultId: string; protocolVersion: string };
      if (info.vaultId !== raw.vaultId || info.protocolVersion !== 'p0') throw new Error('不是目标 P0 测试仓库');
      await chrome.storage.local.set({ connection: { ...raw, endpoint: url.origin } });
      return { connected: true };
    }
    if (command.type !== 'probe') throw new Error('未知操作');
    await chrome.storage.local.remove('result');
    const stored = await chrome.storage.local.get('connection');
    const connection = stored.connection as Connection | undefined;
    if (!connection) throw new Error('请先连接 P0 测试仓库');
    stage = '检查测试插件版本和连接';
    const hello = await fetch(`${connection.endpoint}/v1/hello`, { headers: headers(connection), redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!hello.ok) throw new Error('Connection rejected');
    const capabilities = await hello.json() as { vaultId?: string; capabilities?: string[] };
    if (capabilities.vaultId !== connection.vaultId || !capabilities.capabilities?.includes('content-image-v1')) throw new Error('Update test plugin');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://chatgpt.com/c/')) throw new Error('请打开普通 ChatGPT 聊天');
    stage = '读取当前聊天';
    await chrome.storage.local.set({ progress: '正在验证当前聊天…' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-probe.js'] });
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      return await globalThis.aiInboxP0;
    } });
    const result = results[0]?.result;
    if (!result) throw new Error('页面探针未返回结果');
    latestResult = result;
    await chrome.storage.local.set({ result, progress: '正在记录聊天验证结果…' });
    stage = '记录聊天验证结果';
    const recorded = await fetch(`${connection.endpoint}/v1/probe`, { method: 'POST',
      headers: { ...headers(connection), 'Content-Type': 'application/json' }, body: JSON.stringify(result.metrics),
      signal: AbortSignal.timeout(10000) });
    if (!recorded.ok) throw new Error('验证报告写入失败');
    stage = '读取本机测试图片';
    await chrome.storage.local.set({ progress: '正在验证本机图片传输…' });
    const fixture = await fetch(`${connection.endpoint}/v1/fixture.png`, { headers: headers(connection), signal: AbortSignal.timeout(10000) });
    if (!fixture.ok) throw new Error('本机图片读取失败');
    stage = '本机图片写入与校验';
    const uploaded = await fetch(`${connection.endpoint}/v1/fixture.png`, { method: 'POST', headers: headers(connection),
      body: await fixture.arrayBuffer(), signal: AbortSignal.timeout(10000) });
    if (!uploaded.ok) throw new Error('本机图片校验失败');
    stage = '真实图片写入与回读校验';
    await transferPageImages(tab.id, tab.url, result, connection.endpoint, headers(connection), async (stored, total) => {
      await chrome.storage.local.set({ result, progress: `正在写入测试图片：${stored} / ${total}` });
    });
    await chrome.storage.local.set({ result, progress: 'P0 检查已结束，请查看结果摘要；尚未保存聊天正文。' });
    return result;
  })().then(result => respond({ ok: true, result })).catch(() => {
    const error = `验证未完成。失败步骤：${stage}。请保留此提示；聊天计数若已取得，会保留在下方。`;
    void chrome.storage.local.set({ progress: error, ...(latestResult ? { result: latestResult } : {}) });
    respond({ ok: false, error, ...(latestResult ? { result: latestResult } : {}) });
  }).finally(() => { if (command.type === 'probe') probing = false; });
  return true;
});

function headers(connection: Connection) {
  return { Authorization: `Bearer ${connection.token}`, 'X-AI-Inbox-Vault': connection.vaultId };
}
