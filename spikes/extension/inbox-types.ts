import type { SnapshotData, SaveRequestData } from '../core/schema';
import type { SaveReceipt } from '../core/writer';
import type { inspectMessageList } from '../capture/message-list';
import { ProbeError } from '../shared/errors';

export type Stage = 'connecting' | 'pairing' | 'reading' | 'images' | 'checking' | 'transferring' | 'saving' | 'recovering' | 'success' | 'error';
export interface Connection { endpoint: string; vaultId: string; token: string; }
export interface Preferences { language: 'auto' | 'zh' | 'en'; contextMenu: boolean; }
export interface CaptureDiagnostics { adapterVersion: 2; phase: 'reading' | 'checking'; httpStatus: number | null;
  requestCode: string | null; validation: ReturnType<typeof inspectMessageList>['diagnostics'] | null; }
export class CaptureFailure extends ProbeError {
  constructor(code: string, public readonly diagnostics?: CaptureDiagnostics) { super(code, 'Capture failed before submission'); }
}
export interface Feedback { stage: Stage; code?: string; count?: number; total?: number; receipt?: SaveReceipt; vaultName?: string; pageUrl?: string;
  notSubmitted?: boolean; diagnostics?: CaptureDiagnostics; pairCode?: string; }
export interface Job { tabId: number; pageUrl: string; vaultId: string; request: SaveRequestData; bytes: Record<string, Uint8Array>; }
export interface CaptureState {
  id: string; pageUrl: string; started: number; stage: Stage; count?: number; total?: number; code?: string;
  snapshot?: SnapshotData; bytes: Record<string, Uint8Array>;
  diagnostics?: CaptureDiagnostics;
}
declare global { var aiInboxCaptureOptions: { includeThinking: boolean } | undefined; var aiInboxCapture: CaptureState | undefined; }
