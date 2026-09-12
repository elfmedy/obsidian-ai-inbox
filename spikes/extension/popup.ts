import { isRecord } from '../shared/errors';
import { summarizeProbe } from './probe-summary';
import type { PageProbeResult } from './page-probe-types';
const output = document.querySelector<HTMLPreElement>('#output')!;
const button = document.querySelector<HTMLButtonElement>('#probe')!;
const connection = document.querySelector<HTMLTextAreaElement>('#connection')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const paths = document.querySelector<HTMLElement>('#paths')!;
function render(result: unknown, progress = '') {
  output.textContent = result ? JSON.stringify(result, null, 2) : progress;
  if (isRecord(result) && isRecord(result.metrics) && Array.isArray(result.issues)) {
    summary.textContent = [progress, summarizeProbe(result as unknown as PageProbeResult)].filter(Boolean).join('\n');
    const transfer = isRecord(result.imageTransfer) ? result.imageTransfer : {};
    paths.textContent = Array.isArray(transfer.previewPaths) ? transfer.previewPaths.filter((path): path is string => typeof path === 'string').join('\n') : '';
  } else { summary.textContent = progress; paths.textContent = ''; }
}
document.querySelector<HTMLButtonElement>('#copy')!.onclick = () => {
  void navigator.clipboard.writeText(output.textContent ?? '').catch(() => { summary.textContent = '复制失败，请从诊断详情手动复制。'; });
};
document.querySelector<HTMLButtonElement>('#connect')!.onclick = () => {
  void chrome.runtime.sendMessage({ type: 'connect', connection: connection.value }).then((response: unknown) => {
    if (!isRecord(response)) throw new Error('Invalid response');
    render(undefined, response.ok === true ? '已连接测试仓库' : typeof response.error === 'string' ? response.error : '连接失败');
    if (response.ok === true) connection.value = '';
  }).catch(() => { render(undefined, '连接未完成，请重试'); });
};
button.onclick = () => {
  button.disabled = true;
  render(undefined, '正在验证并准备测试图片…');
  void chrome.runtime.sendMessage({ type: 'probe' }).then((response: unknown) => {
    if (!isRecord(response)) throw new Error('Invalid response');
    render(response.result, response.ok === true ? '' : typeof response.error === 'string' ? response.error : '验证失败');
  }).catch(() => { render(undefined, '验证被中断，请查看保存的诊断结果'); }).finally(() => { button.disabled = false; });
};
void chrome.storage.local.get(['progress', 'result']).then(state => {
  const progress = typeof state.progress === 'string' ? state.progress : '仅用于 P0 技术验证，不导出聊天正文。';
  render(state.result, progress);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.progress && !changes.result)) return;
  void chrome.storage.local.get(['progress', 'result']).then(state => render(state.result, typeof state.progress === 'string' ? state.progress : ''));
});
