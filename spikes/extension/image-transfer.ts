import './page-probe-types';
import { isRecord } from '../shared/errors';
import { MAX_IMAGE_BYTES } from '../assets/inspect';
import type { PageProbeResult } from './page-probe-types';

/** Transfer only extension-isolated cached bytes, never give the page the
 * loopback token. Chrome script results use JSON; read bounded base64 chunks. */
export async function transferPageImages(tabId: number, pageUrl: string, result: PageProbeResult,
  endpoint: string, headers: Record<string, string>, progress: (stored: number, total: number) => Promise<void>) {
  const transfer = result.imageTransfer;
  if (transfer.status !== 'pending') return;
  const captureId = transfer.captureId;
  try {
    for (let index = 0; index < transfer.offered; index++) {
      const descriptorResult = await chrome.scripting.executeScript({ target: { tabId },
        func: (id: string, url: string, imageIndex: number) => {
          const cache = globalThis.aiInboxP0ImageCache;
          if (!cache || cache.captureId !== id || cache.pageUrl !== url || location.href !== url) throw new Error('Capture changed');
          const image = cache.images[imageIndex];
          if (!image) throw new Error('Cached image absent');
          return { byteLength: image.bytes.length, sha256: image.sha256 };
        }, args: [captureId, pageUrl, index] });
      const descriptor = descriptorResult[0]?.result;
      if (!descriptor || !Number.isInteger(descriptor.byteLength) || descriptor.byteLength < 12 ||
          descriptor.byteLength > MAX_IMAGE_BYTES || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error('Image descriptor invalid');
      const bytes = new Uint8Array(descriptor.byteLength);
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const chunkResult = await chrome.scripting.executeScript({ target: { tabId },
          func: (id: string, url: string, imageIndex: number, start: number) => {
            const cache = globalThis.aiInboxP0ImageCache;
            if (!cache || cache.captureId !== id || cache.pageUrl !== url || location.href !== url) throw new Error('Capture changed');
            const data = cache.images[imageIndex]?.bytes.subarray(start, start + 65536);
            if (!data) throw new Error('Image absent');
            let binary = '';
            for (const byte of data) binary += String.fromCharCode(byte);
            return btoa(binary);
          }, args: [captureId, pageUrl, index, offset] });
        const encoded = chunkResult[0]?.result;
        if (typeof encoded !== 'string' || encoded.length > 87384) throw new Error('Image chunk invalid');
        const binary = atob(encoded);
        if (binary.length !== Math.min(65536, bytes.length - offset)) throw new Error('Image chunk size differs');
        for (let cursor = 0; cursor < binary.length; cursor++) bytes[offset + cursor] = binary.charCodeAt(cursor);
      }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== descriptor.sha256) throw new Error('Image transfer digest differs');
      const response = await fetch(`${endpoint}/v1/content-image`, { method: 'POST', redirect: 'error',
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-AI-Inbox-Image-SHA256': digest },
        body: bytes.buffer, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Image upload failed');
      const receipt: unknown = await response.json();
      if (!isRecord(receipt) || receipt.status !== 'content-image-verified' || receipt.sha256 !== digest ||
          receipt.byteLength !== bytes.length || typeof receipt.previewPath !== 'string' ||
          !/^P0\/run-\d+-[a-f0-9]+\/content-images\/[a-f0-9]{64}\.md$/.test(receipt.previewPath)) throw new Error('Image receipt invalid');
      transfer.stored++;
      transfer.previewPaths.push(receipt.previewPath);
      await progress(transfer.stored, transfer.offered);
    }
    transfer.status = 'complete';
  } catch (error) {
    transfer.status = 'failed';
    throw error;
  } finally {
    await chrome.scripting.executeScript({ target: { tabId }, func: (id: string) => {
      if (globalThis.aiInboxP0ImageCache?.captureId === id) {
        globalThis.aiInboxP0ImageCache.images.length = 0;
        globalThis.aiInboxP0ImageCache = undefined;
      }
    }, args: [captureId] }).catch(() => undefined);
  }
}
