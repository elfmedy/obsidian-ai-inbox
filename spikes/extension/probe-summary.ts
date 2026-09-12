import type { PageProbeResult } from './page-probe-types';

export function summarizeProbe(result: PageProbeResult): string {
  const metrics = result.metrics;
  const blocked = result.issues.filter(code => code !== 'LIVE_FRESHNESS_AND_FULL_HISTORY_REQUIRE_MANUAL_VALIDATION');
  if (!metrics.chainMatchesVisible || metrics.capturedMessages === 0 || metrics.failedImages > 0 || blocked.length > 0) {
    return '本次检查未通过，请展开诊断详情。尚未保存完整聊天。';
  }
  const transfer = result.imageTransfer;
  if (transfer?.status === 'complete' && transfer.stored === transfer.offered && transfer.stored > 0) {
    return `消息抓取检查通过（${metrics.capturedMessages} 条）；${transfer.stored} 张测试图片已写入 Vault，回读字节一致。请打开下方本地预览验证离线显示。尚未保存聊天正文。`;
  }
  if (transfer?.status === 'not-needed') return `消息抓取检查通过（${metrics.capturedMessages} 条）；本次没有可见图片。尚未保存聊天正文。`;
  if (transfer?.status === 'failed') return `消息抓取检查通过；图片传输未全部确认（${transfer.stored} / ${transfer.offered}）。请查看失败步骤，不能视为保存成功。`;
  return `消息抓取检查通过（${metrics.capturedMessages} 条）；图片落盘尚未确认。尚未保存聊天正文。`;
}
