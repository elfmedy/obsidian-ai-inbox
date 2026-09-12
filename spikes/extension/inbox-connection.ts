import { z } from 'zod';
import { ProbeError } from '../shared/errors';
import type { Connection } from './inbox-types';
const Schema = z.strictObject({ endpoint: z.string().regex(/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/$/), vaultId: z.uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) });
export function parseConnection(value: unknown): Connection {
  const parsed = Schema.safeParse(value);
  if (!parsed.success || Number(new URL(parsed.data.endpoint).port) > 65535) throw new ProbeError('CONNECTION_INVALID', 'Invalid local connection');
  return parsed.data;
}
export async function receiver(connection: Connection, path: string, init: RequestInit = {}, timeout = 30000): Promise<unknown> {
  const response = await fetch(new URL(path, connection.endpoint), { ...init, redirect: 'error', cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${connection.token}`, 'X-AI-Inbox-Vault': connection.vaultId }, signal: AbortSignal.timeout(timeout) });
  const text = await response.text(); if (text.length > 16384) throw new ProbeError('RECEIPT_INVALID', 'Response too large');
  const data: unknown = JSON.parse(text);
  if (!response.ok) throw new ProbeError(typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string' ? data.code : 'RECEIVER_FAILED', 'Receiver rejected the request');
  return data;
}
