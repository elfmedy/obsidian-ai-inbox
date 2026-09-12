// Controlled Chrome menu regression. Uses an isolated profile and never opens a chat or a Vault.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const runtimeRequire = createRequire(process.env.PLAYWRIGHT_MODULE_PATH ?? resolve(root, 'package.json'));
const { chromium } = runtimeRequire('playwright');
const source = resolve(root, process.argv[2] ?? 'dist/alpha/chrome-extension');
const expectDuplicates = process.argv.includes('--expect-duplicates');
const target = resolve(root, `.local/menu-check-${Date.now()}`); const extension = join(target, 'extension');
await mkdir(target, { recursive: true }); await cp(source, extension, { recursive: true });
// Observe native callback results, including failures from legacy code that did
// not supply a callback. The tested rebuild itself remains the packaged code.
const instrumentation = `
const menuProbe = globalThis.menuProbe = { errors: [], items: {}, operations: 0, pending: 0, installed: [], startup: [] };
for (const event of ['onInstalled', 'onStartup']) {
 const original = chrome.runtime[event].addListener.bind(chrome.runtime[event]);
 chrome.runtime[event].addListener = listener => { menuProbe[event === 'onInstalled' ? 'installed' : 'startup'].push(listener); original(listener); };
}
const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
chrome.storage.local.get = async (...args) => { if (args[0] === 'preferences') await new Promise(r => setTimeout(r, 20)); return originalGet(...args); };
for (const operation of ['removeAll', 'create']) {
 const original = chrome.contextMenus[operation].bind(chrome.contextMenus);
 chrome.contextMenus[operation] = (...args) => {
  const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
  menuProbe.pending++;
  return original(...args, () => {
   const error = chrome.runtime.lastError;
   if (error) menuProbe.errors.push(error.message);
   else if (operation === 'removeAll') menuProbe.items = {};
   else menuProbe.items[args[0].id] = args[0];
   menuProbe.pending--; menuProbe.operations++;
   callback?.();
  });
 };
}
`;
await writeFile(join(extension, 'inbox-background.js'), instrumentation + await readFile(join(extension, 'inbox-background.js'), 'utf8'));
const context = await chromium.launchPersistentContext(join(target, 'profile'), { headless: true,
  ...(process.env.AI_INBOX_TEST_CHROME ? { executablePath: process.env.AI_INBOX_TEST_CHROME } : { channel: 'chromium' }),
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
try {
  const cdp = await context.browser().newBrowserCDPSession(); await cdp.send('Extensions.loadUnpacked', { path: extension });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    // Exercise the actual registered handlers together, plus real storage events.
    for (let i = 0; i < 4; i++) {
      for (const listener of menuProbe.installed) listener({ reason: 'update' });
      for (const listener of menuProbe.startup) listener();
      await chrome.storage.local.set({ preferences: { language: i % 2 ? 'zh' : 'en', contextMenu: i % 2 === 0 } });
    }
    await chrome.storage.local.set({ preferences: { language: 'en', contextMenu: false } });
  });
  let previous = -1; let stable = 0; let state;
  for (let i = 0; i < 200; i++) {
    state = await worker.evaluate(() => ({ errors: menuProbe.errors, items: menuProbe.items, operations: menuProbe.operations, pending: menuProbe.pending }));
    stable = state.operations === previous && state.pending === 0 && state.operations > 0 ? stable + 1 : 0;
    previous = state.operations; if (stable >= 5) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.ok(stable >= 5, 'Menu rebuild did not settle');
  if (expectDuplicates) assert.ok(state.errors.some(error => error.includes('duplicate id settings')), 'Expected legacy duplicate-ID reproduction');
  else {
    assert.deepEqual(state.errors, []); assert.deepEqual(Object.keys(state.items).sort(), ['settings', 'status']);
    assert.equal(state.items.settings.title, 'Switch vault / Settings');
  }
  const report = { passed: true, legacyReproduction: expectDuplicates, duplicateErrors: state.errors.length, operations: state.operations,
    menuIds: Object.keys(state.items), latestPreferencesApplied: !expectDuplicates };
  await writeFile(join(target, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await context.close(); }
