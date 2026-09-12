import { describe, it, expect, vi } from 'vitest';
vi.mock('../spikes/extension/inbox-vaults', async () => {
  const { ProbeError } = await import('../spikes/shared/errors');
  return { selectVault: async () => { throw new ProbeError('VAULT_SELECTION_REQUIRED', 'Select a vault'); }, vaultOverview: vi.fn() };
});
describe('vault chooser lifecycle', () => {
  it('finishes page feedback before opening the chooser and releases the tab for another click', async () => {
    let click: ((tab: { id: number; url: string }) => void) | undefined; let chooserOpen = false;
    const events: string[] = []; const url = 'https://chatgpt.com/c/synthetic';
    const openOptionsPage = vi.fn(async () => { chooserOpen = true; events.push('chooser'); });
    const chromeMock = {
      action: { onClicked: { addListener: (listener: typeof click) => { click = listener; } } },
      contextMenus: { onClicked: { addListener: vi.fn() } },
      runtime: { id: 'a'.repeat(32), openOptionsPage, onMessage: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() } },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async (data: { lastStatus?: { stage: string } }) => { if (data.lastStatus) events.push(data.lastStatus.stage); }) }, onChanged: { addListener: vi.fn() } },
      tabs: { get: vi.fn(async () => ({ url })), sendMessage: vi.fn(async () => { events.push('feedback-complete'); }) },
      scripting: { executeScript: vi.fn(async () => {
        // Model the regression: Chrome can suspend injection into the chat
        // after openOptionsPage takes focus. The save lock must not wait on it.
        if (chooserOpen) return new Promise(() => undefined);
        return [];
      }) },
    };
    vi.stubGlobal('chrome', chromeMock);
    try {
      await import('../spikes/extension/inbox-background');
      click!({ id: 1, url }); await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(1));
      expect(events).toEqual(['connecting', 'feedback-complete', 'error', 'feedback-complete', 'chooser']);
      chooserOpen = false;
      click!({ id: 1, url }); await vi.waitFor(() => expect(openOptionsPage).toHaveBeenCalledTimes(2));
    } finally { vi.unstubAllGlobals(); }
  });
});
