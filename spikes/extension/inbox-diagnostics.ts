import type { Feedback } from './inbox-types';
export function diagnosticText(feedback: Feedback, extensionVersion: string): string {
  // Explicit selection excludes page URL, private title/path, receipt and vault.
  return JSON.stringify({ extensionVersion, code: feedback.code ?? null, notSubmitted: feedback.notSubmitted === true,
    capture: feedback.diagnostics ?? null }, null, 2);
}
