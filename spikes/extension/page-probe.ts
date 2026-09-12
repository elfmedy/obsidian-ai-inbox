import { inspectHydration } from '../capture/hydration';
import { fetchCurrentDocument } from '../capture/fresh-document';
import { probeObservedRequest } from '../capture/observed-request';
import { summarizeGraphShape } from '../capture/graph-shape';
import { verifyCurrentPath } from '../capture/graph';
import { allowPageImage, detectImageType, readBounded } from '../assets/inspect';
import type { PageProbeResult } from './page-probe-types';
import { ProbeError } from '../shared/errors';
import { isCitationFavicon } from '../assets/content-image';

globalThis.aiInboxP0 = (async (): Promise<PageProbeResult> => {
  const startUrl = location.href;
  const captureId = crypto.randomUUID();
  const imageCache = { captureId, pageUrl: startUrl, images: [] as Array<{ bytes: Uint8Array; sha256: string }> };
  globalThis.aiInboxP0ImageCache = imageCache;
  setTimeout(() => {
    if (globalThis.aiInboxP0ImageCache === imageCache) globalThis.aiInboxP0ImageCache = undefined;
    imageCache.images.length = 0;
  }, 5 * 60 * 1000);
  const match = /^\/c\/([a-zA-Z0-9-]+)\/?$/.exec(location.pathname);
  if (location.origin !== 'https://chatgpt.com' || !match) throw new ProbeError('UNSUPPORTED_PAGE', '普通聊天页面才可验证');
  if (document.querySelector('[data-testid="stop-button"]')) throw new ProbeError('SOURCE_GENERATING', '请等待回复完成');
  const issues: string[] = [];
  const visible = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role]'));
  const scriptTexts = Array.from(document.scripts, script => script.textContent ?? '');
  const resources = performance.getEntriesByType('resource').filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
    .map(entry => ({ name: entry.name, initiatorType: entry.initiatorType }));
  const loaded = inspectHydration(scriptTexts, match[1]!);
  let fresh: ReturnType<typeof inspectHydration> | undefined;
  try {
    const html = await fetchCurrentDocument(startUrl);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    fresh = inspectHydration(Array.from(parsed.scripts, script => script.textContent ?? ''), match[1]!);
  } catch (error) {
    issues.push(error instanceof ProbeError ? error.code : 'DOCUMENT_REQUEST_FAILED');
  }
  // An empty fresh response must not be masked by a stale loaded graph.
  let graphs = (fresh ?? loaded).graphs;
  let request: Awaited<ReturnType<typeof probeObservedRequest>> | undefined;
  if (graphs.length === 0) {
    request = await probeObservedRequest({ pageUrl: startUrl, resources, scripts: scriptTexts });
    if (request.diagnostics.error) issues.push(request.diagnostics.error);
    if (request.diagnostics.requestedTurnLimit !== null && request.diagnostics.messageArray?.coverage !== 'complete') {
      issues.push('TURN_LIMITED_REQUEST_REQUIRES_COMPLETENESS_VALIDATION');
    }
    if (request.diagnostics.messageArray) issues.push(...request.diagnostics.messageArray.issues);
    if (request.graphs.length > 0) graphs = request.graphs;
  }
  const paths = [];
  for (const graph of graphs) {
    try { paths.push(verifyCurrentPath(graph, match[1]!)); }
    catch (error) { issues.push(error instanceof ProbeError ? error.code : 'GRAPH_INVALID'); }
  }
  const verified = paths.length === 1 ? paths[0] : undefined;
  const verifiedList = request?.messageList?.diagnostics.validated && !request.diagnostics.error ? request.messageList : undefined;
  const captured = verifiedList?.messages ?? verified?.messages;
  const visibleIds = visible.map(element => element.dataset.messageId);
  const ids = captured?.map(message => message.id) ?? [];
  const positions = visibleIds.map(id => id ? ids.indexOf(id) : -1);
  const chainMatchesVisible = positions.length > 0 && positions.every((position, index) =>
    position >= 0 && (index === 0 || position > positions[index - 1]!)) && positions.at(-1) === ids.length - 1;
  const images = [...new Set(visible.flatMap(element => Array.from(element.querySelectorAll('img'))))]
    .filter(image => !isCitationFavicon(image.currentSrc || image.src));
  let downloadedImages = 0;
  let decodedImages = 0;
  let failedImages = 0;
  let cachedBytes = 0;
  // Deliberately small P0 probe budget; it never claims a complete image export.
  for (const image of images.slice(0, 10)) {
    try {
      const url = image.currentSrc || image.src;
      if (!allowPageImage(url, location.origin)) throw new ProbeError('IMAGE_ORIGIN_UNVERIFIED', 'Origin needs a verified resolver');
      const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000) });
      const bytes = await readBounded(response);
      const mime = detectImageType(bytes);
      downloadedImages++;
      const imageBitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: mime }));
      imageBitmap.close();
      decodedImages++;
      cachedBytes += bytes.length;
      if (cachedBytes > 50 * 1024 * 1024) throw new ProbeError('IMAGE_CACHE_LIMIT', 'Image probe total exceeds limit');
      const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      imageCache.images.push({ bytes, sha256 });
    } catch (error) {
      failedImages++;
      issues.push(error instanceof ProbeError ? error.code : 'IMAGE_FETCH_OR_DECODE_FAILED');
    }
  }
  if (images.length > 10) issues.push('IMAGE_PROBE_LIMIT_10');
  if (location.href !== startUrl) throw new ProbeError('SOURCE_CHANGED', '聊天在验证过程中发生切换');
  const finalIds = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role]'), element => element.dataset.messageId);
  if (document.querySelector('[data-testid="stop-button"]') || JSON.stringify(finalIds) !== JSON.stringify(visibleIds)) {
    throw new ProbeError('SOURCE_CHANGED', '验证过程中消息发生变化');
  }
  if (!captured) issues.push('NO_VALIDATED_CONVERSATION_SOURCE');
  if (!chainMatchesVisible) issues.push('VISIBLE_CHAIN_NOT_CONFIRMED');
  const canTransfer = !!captured && chainMatchesVisible && failedImages === 0 && images.length <= 10;
  if (!canTransfer) imageCache.images.length = 0;
  issues.push('LIVE_FRESHNESS_AND_FULL_HISTORY_REQUIRE_MANUAL_VALIDATION');
  return {
    imageTransfer: { captureId, offered: imageCache.images.length, stored: 0, previewPaths: [],
      status: !canTransfer ? 'blocked' : imageCache.images.length ? 'pending' : 'not-needed' },
    diagnostics: { probeVersion: 8, loaded: loaded.diagnostics, fresh: fresh?.diagnostics ?? null,
      freshRequest: fresh ? 'completed' : 'failed', selectedSource: request?.diagnostics.httpStatus === 200 ? 'observed-request' : fresh ? 'fresh-document' : 'loaded-dom',
      request: request?.diagnostics ?? null, graphShapes: graphs.slice(0, 3).map(summarizeGraphShape) },
    metrics: { graphCandidates: graphs.length, verifiedGraphs: paths.length, visibleMessages: visible.length,
      capturedMessages: captured?.length ?? 0, imageElements: images.length,
      downloadedImages, decodedImages, failedImages, chainMatchesVisible, requiresLiveValidation: true },
    issues: [...new Set(issues)],
  };
})();
