import { describe, it, expect, vi } from 'vitest';
import { PairingSessions } from '../src/transport/pairing';
const request = { clientId: 'a'.repeat(32), secret: 'b'.repeat(64) };
const origin = `chrome-extension://${request.clientId}`;
describe('explicit, expiring browser pairing', () => {
  it('supports the numeric timer handles provided by the Obsidian renderer', () => {
    const timer = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(1 as unknown as ReturnType<typeof setTimeout>);
    const sessions = new PairingSessions(async () => false);
    try { expect(sessions.start(request, origin).status).toBe('pending'); } finally { sessions.close(); timer.mockRestore(); }
  });
  it('allows a new user attempt after cancellation without waiting for expiry', async () => {
    const sessions = new PairingSessions(async () => false);
    try {
      const first = sessions.start(request, origin);
      await vi.waitFor(() => expect(sessions.poll({ ...request, pairId: first.pairId }, origin).status).toBe('rejected'));
      expect(sessions.start({ ...request, secret: 'e'.repeat(64) }, origin).pairId).not.toBe(first.pairId);
    } finally { sessions.close(); }
  });
  it('only approves after the Vault confirms, and permits retry with the same secret', async () => {
    let approve: (value: boolean) => void = () => undefined;
    const sessions = new PairingSessions(() => new Promise(resolve => { approve = resolve; }));
    try {
      const start = sessions.start(request, origin); expect(start.status).toBe('pending');
      expect(sessions.start(request, origin)).toEqual(start);
      expect(JSON.stringify(start)).not.toContain(request.secret);
      await Promise.resolve(); approve(true);
      await vi.waitFor(() => expect(sessions.poll({ ...request, pairId: start.pairId }, origin).status).toBe('approved'));
      expect(() => sessions.poll({ ...request, pairId: start.pairId, secret: 'c'.repeat(64) }, origin)).toThrow();
      expect(() => sessions.poll({ ...request, pairId: start.pairId, clientId: 'd'.repeat(32) }, undefined)).toThrow();
    } finally { sessions.close(); }
  });
  it('rejects mismatched origins and bounds concurrent confirmation prompts', () => {
    const sessions = new PairingSessions(async () => false);
    try {
      expect(() => sessions.start(request, 'https://chatgpt.com')).toThrow();
      expect(() => sessions.start(request, `chrome-extension://${'c'.repeat(32)}`)).toThrow();
      sessions.start(request, origin);
      expect(() => sessions.start({ ...request, secret: 'd'.repeat(64) }, origin)).toThrow('Another pairing');
    } finally { sessions.close(); }
  });
  it('expires pending confirmations and ignores later approval', async () => {
    vi.useFakeTimers(); let approve: (value: boolean) => void = () => undefined; let signal: AbortSignal | undefined;
    const sessions = new PairingSessions(prompt => { signal = prompt.signal; return new Promise(resolve => { approve = resolve; }); }, 1000);
    try {
      const start = sessions.start(request, origin); await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1001); expect(signal?.aborted).toBe(true);
      approve(true); await Promise.resolve();
      expect(() => sessions.poll({ ...request, pairId: start.pairId }, origin)).toThrow('expired');
    } finally { sessions.close(); vi.useRealTimers(); }
  });
});
