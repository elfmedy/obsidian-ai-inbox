import { randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ProbeError } from '../shared/errors';

export interface PairPrompt { clientId: string; code: string; signal: AbortSignal; }
export type ConfirmPair = (prompt: PairPrompt) => Promise<boolean>;
const Start = z.strictObject({ clientId: z.string().regex(/^[a-p]{32}$/), secret: z.string().regex(/^[a-f0-9]{64}$/) });
const Poll = Start.extend({ pairId: z.uuid() });
const digest = (value: string) => createHash('sha256').update(value).digest();
export class PairingSessions {
  private session: { id: string; clientId: string; secret: Buffer; code: string; expires: number;
    status: 'pending' | 'approved' | 'rejected'; controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  constructor(private readonly confirm: ConfirmPair | undefined, private readonly ttl = 120000) {}
  start(input: unknown, origin: string | undefined) {
    const parsed = Start.safeParse(input);
    if (!parsed.success) throw new ProbeError('PAIRING_INVALID', 'Invalid pairing request');
    const data = parsed.data;
    if (origin && origin !== `chrome-extension://${data.clientId}`) throw new ProbeError('ORIGIN_INVALID', 'Pairing origin differs');
    if (!this.confirm) throw new ProbeError('PAIRING_UNAVAILABLE', 'Pairing unavailable');
    if (this.session && this.session.expires <= Date.now()) this.close();
    if (this.session?.status === 'rejected') this.close();
    if (this.session) {
      if (this.session.clientId === data.clientId && timingSafeEqual(this.session.secret, digest(data.secret))) return this.publicState();
      throw new ProbeError('PAIRING_BUSY', 'Another pairing is active');
    }
    const controller = new AbortController();
    const session = { id: randomUUID(), clientId: data.clientId, secret: digest(data.secret), code: String(randomInt(100000, 1000000)),
      expires: Date.now() + this.ttl, status: 'pending' as 'pending' | 'approved' | 'rejected', controller,
      timer: setTimeout(() => this.close(), this.ttl) };
    // Obsidian's renderer may expose browser timers (numeric handles).
    this.session = session;
    void Promise.resolve().then(() => this.confirm!({ clientId: data.clientId, code: session.code, signal: controller.signal }))
      .then(approved => { if (this.session === session && !controller.signal.aborted) session.status = approved ? 'approved' : 'rejected'; })
      .catch(() => { if (this.session === session) session.status = 'rejected'; });
    return this.publicState();
  }
  poll(input: unknown, origin: string | undefined) {
    const parsed = Poll.safeParse(input);
    if (!parsed.success) throw new ProbeError('PAIRING_INVALID', 'Invalid pairing request');
    const data = parsed.data; const session = this.session;
    if (origin && origin !== `chrome-extension://${data.clientId}`) throw new ProbeError('ORIGIN_INVALID', 'Pairing origin differs');
    if (!session || session.expires <= Date.now() || data.pairId !== session.id || data.clientId !== session.clientId || !timingSafeEqual(session.secret, digest(data.secret))) {
      throw new ProbeError('PAIRING_EXPIRED', 'Pairing expired or secret differs');
    }
    return this.publicState();
  }
  private publicState() { const session = this.session!; return { pairId: session.id, code: session.code, status: session.status, expiresAt: session.expires }; }
  close() { const session = this.session; this.session = undefined; if (session) { clearTimeout(session.timer); session.controller.abort(); } }
}
