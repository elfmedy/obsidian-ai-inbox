import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { chooseVault, discoverVaults, type DiscoveredVault } from '../spikes/extension/inbox-discovery';
const vault = (vaultName: string): DiscoveredVault => ({ app: 'ai-inbox', protocolVersion: 1, pairingVersion: 1,
  vaultId: randomUUID(), vaultName, endpoint: 'http://127.0.0.1:27125/' });
describe('running vault selection', () => {
  it('automatically selects one vault but requires a choice for multiple vaults', () => {
    const a = vault('A'); const b = vault('B');
    expect(chooseVault([a])).toEqual(a);
    expect(() => chooseVault([a, b])).toThrow('Select a vault');
    expect(chooseVault([a, b], b.vaultId)).toEqual(b);
  });
  it('fails when the chosen default is closed instead of routing to another running vault', () => {
    expect(() => chooseVault([vault('Other')], randomUUID())).toThrow('Default vault');
    expect(() => chooseVault([])).toThrow('No running vault');
  });
  it('discovers only compatible responses in the bounded loopback port range', async () => {
    const a = vault('A'); const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); calls.push(url.href);
      if (url.port === '27125') return Response.json(a);
      if (url.port === '27126') return Response.json({ app: 'something-else' });
      throw new Error('Offline');
    }) as typeof fetch;
    expect(await discoverVaults(fetcher)).toEqual([a]); expect(calls).toHaveLength(10);
    expect(calls.every(url => /^http:\/\/127\.0\.0\.1:271\d{2}\/v1\/discovery$/.test(url))).toBe(true);
  });
  it('rejects copied Vault identities instead of selecting an arbitrary server', async () => {
    const a = vault('A'); const fetcher = (async () => Response.json(a)) as typeof fetch;
    await expect(discoverVaults(fetcher)).rejects.toThrow('Duplicate vault');
  });
});
