import { z } from 'zod';
import { DISCOVERY_PORTS } from '../shared/discovery';
import { ProbeError } from '../shared/errors';
const Advert = z.object({ app: z.literal('ai-inbox'), protocolVersion: z.literal(1), pairingVersion: z.number().int(), vaultId: z.uuid(), vaultName: z.string().min(1).max(512) });
export type DiscoveredVault = z.infer<typeof Advert> & { endpoint: string };
export async function discoveryRequest(endpoint: string, path: string, body?: unknown, fetcher: typeof fetch = fetch): Promise<unknown> {
  let response: Response;
  try { response = await fetcher(new URL(path, endpoint), { ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(1500) }); }
  catch { throw new ProbeError('OBSIDIAN_UNAVAILABLE', 'Receiver is unavailable'); }
  const text = await response.text(); if (text.length > 16384) throw new ProbeError('RECEIPT_INVALID', 'Response too large');
  const value: unknown = JSON.parse(text);
  if (!response.ok) {
    const error = z.object({ code: z.string().regex(/^[A-Z_]{1,100}$/) }).safeParse(value);
    throw new ProbeError(error.success ? error.data.code : 'RECEIVER_FAILED', 'Receiver rejected request');
  }
  return value;
}
export async function discoverVaults(fetcher: typeof fetch = fetch): Promise<DiscoveredVault[]> {
  const results = await Promise.allSettled(DISCOVERY_PORTS.map(async port => {
    const endpoint = `http://127.0.0.1:${port}/`;
    return { ...Advert.parse(await discoveryRequest(endpoint, 'v1/discovery', undefined, fetcher)), endpoint };
  }));
  const vaults = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (new Set(vaults.map(vault => vault.vaultId)).size !== vaults.length) throw new ProbeError('VAULT_ID_AMBIGUOUS', 'Duplicate vault identity');
  return vaults.sort((a, b) => a.vaultName.localeCompare(b.vaultName));
}
export function chooseVault(vaults: DiscoveredVault[], defaultId?: string): DiscoveredVault {
  if (defaultId) { const match = vaults.find(vault => vault.vaultId === defaultId); if (match) return match; throw new ProbeError('DEFAULT_VAULT_UNAVAILABLE', 'Default vault is not running'); }
  if (!vaults.length) throw new ProbeError('OBSIDIAN_UNAVAILABLE', 'No running vault found');
  if (vaults.length > 1) throw new ProbeError('VAULT_SELECTION_REQUIRED', 'Select a vault');
  return vaults[0]!;
}
