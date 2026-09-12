import type { ProbeMetrics } from '../transport/server';
import type { inspectHydration } from '../capture/hydration';
import type { RequestDiagnostics } from '../capture/observed-request';
import type { summarizeGraphShape } from '../capture/graph-shape';
type HydrationCounts = ReturnType<typeof inspectHydration>['diagnostics'];
export interface PageProbeResult {
  metrics: ProbeMetrics; issues: string[];
  imageTransfer: { captureId: string; offered: number; stored: number;
    status: 'pending' | 'not-needed' | 'blocked' | 'complete' | 'failed'; previewPaths: string[] };
  diagnostics: { probeVersion: 8; loaded: HydrationCounts; fresh: HydrationCounts | null;
    freshRequest: 'completed' | 'failed'; selectedSource: 'fresh-document' | 'loaded-dom' | 'observed-request';
    request: RequestDiagnostics | null; graphShapes: ReturnType<typeof summarizeGraphShape>[] };
}
declare global {
  var aiInboxP0: Promise<PageProbeResult> | undefined;
  var aiInboxP0ImageCache: { captureId: string; pageUrl: string;
    images: Array<{ bytes: Uint8Array; sha256: string }> } | undefined;
}
