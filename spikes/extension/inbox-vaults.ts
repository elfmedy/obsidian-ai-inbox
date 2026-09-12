import { z } from 'zod';
import type { Connection } from './inbox-types';
import { parseConnection, receiver } from './inbox-connection';
import { discoverVaults, discoveryRequest, chooseVault, type DiscoveredVault } from './inbox-discovery';
import { ProbeError } from '../shared/errors';
const Hello = z.object({ protocolVersion: z.literal(1), vaultId: z.uuid(), vaultName: z.string().max(512) });
const PairState = z.object({ pairId: z.uuid(), code: z.string().regex(/^\d{6}$/), expiresAt: z.number(), status: z.enum(['pending', 'approved', 'rejected']), connection: z.unknown().optional() });
interface KnownVault { connection: Connection; vaultName: string; }
export interface PairProgress { code: string; vaultName: string; }
let selecting = false;
async function remember(connection: Connection, vaultName: string) {
  const stored = await chrome.storage.local.get('connections'); const connections = (stored.connections ?? {}) as Record<string, KnownVault>;
  await chrome.storage.local.set({ connection, defaultVaultName: vaultName, connections: { ...connections, [connection.vaultId]: { connection, vaultName } } });
}
async function pair(vault: DiscoveredVault, progress: (value: PairProgress) => Promise<void>): Promise<Connection> {
  if (vault.pairingVersion !== 1) throw new ProbeError('PAIRING_UNAVAILABLE', 'Update the Obsidian plugin');
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const request = { clientId: chrome.runtime.id, secret };
  const first = PairState.parse(await discoveryRequest(vault.endpoint, 'v1/pair', request));
  await progress({ code: first.code, vaultName: vault.vaultName });
  const deadline = Math.min(Date.now() + 120000, first.expiresAt);
  while (Date.now() < deadline) {
    const state = PairState.parse(await discoveryRequest(vault.endpoint, 'v1/pair/status', { ...request, pairId: first.pairId }));
    if (state.pairId !== first.pairId || state.code !== first.code) throw new ProbeError('PAIRING_INVALID', 'Pairing identity changed');
    if (state.status === 'rejected') throw new ProbeError('PAIRING_REJECTED', 'Pairing was cancelled');
    if (state.status === 'approved') {
      const connection = parseConnection(state.connection);
      if (connection.endpoint !== vault.endpoint || connection.vaultId !== vault.vaultId) throw new ProbeError('PAIRING_INVALID', 'Pairing destination changed');
      return connection;
    }
    // A trusted extension API call keeps this user-initiated operation alive.
    await chrome.storage.local.set({ pairingStatus: { code: first.code, vaultName: vault.vaultName } });
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  throw new ProbeError('PAIRING_EXPIRED', 'Pairing timed out');
}
async function connect(vault: DiscoveredVault, progress: (value: PairProgress) => Promise<void>) {
  const stored = await chrome.storage.local.get(['connection', 'connections']);
  const known = (stored.connections as Record<string, KnownVault> | undefined)?.[vault.vaultId];
  const legacy = stored.connection ? parseConnection(stored.connection) : undefined;
  let connection = known?.connection ?? (legacy?.vaultId === vault.vaultId ? legacy : undefined);
  if (connection) {
    connection = { ...parseConnection(connection), endpoint: vault.endpoint };
    try {
      const hello = Hello.parse(await receiver(connection, 'v1/hello', {}, 2000));
      if (hello.vaultId !== vault.vaultId) throw new ProbeError('VAULT_MISMATCH', 'Vault identity differs');
      await remember(connection, hello.vaultName); return { connection, vaultName: hello.vaultName };
    } catch (error) { if (!(error instanceof ProbeError) || error.code !== 'UNAUTHORIZED') throw error; }
  }
  connection = await pair(vault, progress);
  const hello = Hello.parse(await receiver(connection, 'v1/hello', {}, 2000));
  if (hello.vaultId !== vault.vaultId) throw new ProbeError('VAULT_MISMATCH', 'Vault identity differs');
  await remember(connection, hello.vaultName); return { connection, vaultName: hello.vaultName };
}
export async function selectVault(vaultId: string | undefined, progress: (value: PairProgress) => Promise<void>) {
  if (selecting) throw new ProbeError('PAIRING_BUSY', 'A connection is in progress');
  selecting = true;
  try {
    const stored = await chrome.storage.local.get('connection');
    const defaultId = vaultId ?? (stored.connection ? parseConnection(stored.connection).vaultId : undefined);
    return await connect(chooseVault(await discoverVaults(), defaultId), progress);
  } finally { selecting = false; await chrome.storage.local.remove('pairingStatus'); }
}
export async function vaultOverview() {
  const [vaults, stored] = await Promise.all([discoverVaults(), chrome.storage.local.get(['connection', 'defaultVaultName', 'connections'])]);
  const defaultId = stored.connection ? parseConnection(stored.connection).vaultId : null;
  return { defaultId, defaultName: defaultId ? (vaults.find(vault => vault.vaultId === defaultId)?.vaultName ?? (typeof stored.defaultVaultName === 'string' ? stored.defaultVaultName : '')) : '',
    vaults: vaults.map(vault => ({ vaultId: vault.vaultId, vaultName: vault.vaultName,
      paired: !!(stored.connections as Record<string, KnownVault> | undefined)?.[vault.vaultId] || defaultId === vault.vaultId })) };
}
