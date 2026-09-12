import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenuUpdater } from '../spikes/extension/inbox-menus';

function fixture() {
  const items = new Map<string, chrome.contextMenus.CreateProperties>();
  let prefs = { language: 'zh', contextMenu: true }; let active = 0; let maximum = 0;
  let fail: 'removeAll' | 'create' | undefined;
  let lastError: { message: string } | undefined; let errorReads = 0;
  const finish = (operation: 'removeAll' | 'create', action: () => void, callback: () => void) => {
    active++; maximum = Math.max(maximum, active);
    setTimeout(() => {
      active--;
      if (fail === operation) { fail = undefined; lastError = { message: `Synthetic ${operation} failure` }; }
      else action();
      callback(); lastError = undefined;
    }, 1);
  };
  vi.stubGlobal('chrome', {
    runtime: { get lastError() { if (lastError) errorReads++; return lastError; } },
    i18n: { getUILanguage: () => 'en' },
    storage: { local: { get: async () => ({ preferences: { ...prefs } }) } },
    contextMenus: {
      // Deliberately callback-only: await removeAll() alone must not work here.
      removeAll: (callback: () => void) => { finish('removeAll', () => items.clear(), callback); },
      create: (item: chrome.contextMenus.CreateProperties, callback: () => void) => {
        finish('create', () => {
          if (items.has(item.id!)) lastError = { message: `Cannot create item with duplicate id ${item.id}` };
          else items.set(item.id!, item);
        }, callback);
        return item.id;
      },
    },
  });
  return { items, setPrefs: (value: typeof prefs) => { prefs = value; }, fail: (value: typeof fail) => { fail = value; },
    maximum: () => maximum, errorReads: () => errorReads };
}
afterEach(() => vi.unstubAllGlobals());
describe('context menu lifecycle', () => {
  it('serializes overlapping events through creation callbacks and ends with the latest preferences', async () => {
    const state = fixture(); const update = createMenuUpdater();
    const first = update(); await new Promise(resolve => setTimeout(resolve, 2));
    const queued = [update(), update(), update()];
    state.setPrefs({ language: 'en', contextMenu: false });
    await Promise.all([first, ...queued, update()]);
    expect(state.maximum()).toBe(1); expect(state.errorReads()).toBe(0);
    expect([...state.items.keys()]).toEqual(['settings', 'status']);
    expect(state.items.get('settings')?.title).toBe('Switch vault / Settings');
    state.setPrefs({ language: 'zh', contextMenu: true }); await update();
    expect(state.items.get('settings')?.title).toBe('切换仓库 / 设置');
    expect(state.items.get('save')?.documentUrlPatterns).toEqual(['https://chatgpt.com/c/*']);
  });
  it.each(['removeAll', 'create'] as const)('consumes %s lastError, reports failure, and allows the next rebuild', async operation => {
    const state = fixture(); const update = createMenuUpdater(); state.fail(operation);
    await expect(update()).rejects.toThrow(`Synthetic ${operation} failure`);
    expect(state.errorReads()).toBe(1);
    await update(); expect([...state.items.keys()]).toEqual(['settings', 'status', 'save']);
  });
});
