// Runs the packaged extension against an entirely synthetic ChatGPT-shaped
// page in a NEW, isolated browser profile. No real account/browser is accessed.
// Uses Chrome's official Extensions debugging protocol to load the unchanged
// package and trigger its toolbar action (including the activeTab grant).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..');
const runtimeRequire = createRequire(process.env.PLAYWRIGHT_MODULE_PATH ?? resolve(root, 'package.json'));
const { chromium } = runtimeRequire('playwright');
const vault = resolve(root, '.local/p0-vault');
assert.equal(JSON.parse(await readFile(join(vault, 'AI-INBOX-P0-VAULT.json'), 'utf8')).purpose, 'ai-inbox-p0-isolated-tests');
const config = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8'));
const testRoot = resolve(root, `.local/browser-check-${Date.now()}`); const extension = join(testRoot, 'extension');
await mkdir(testRoot, { recursive: true }); await cp(resolve(root, 'dist/alpha/chrome-extension'), extension, { recursive: true });
const launch = () => chromium.launchPersistentContext(join(testRoot, 'profile'), { headless: true,
  ...(process.env.AI_INBOX_TEST_CHROME ? { executablePath: process.env.AI_INBOX_TEST_CHROME } : { channel: 'chromium' }),
  ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'], viewport: { width: 1100, height: 820 } });
let context = await launch();
let secondaryServer; let pausedReceiver = false;
const originalContentSettings = { includeThinking: config.includeThinking ?? false, includeTitle: config.includeTitle ?? false, language: config.language ?? 'auto' };
const cli = process.env.OBSIDIAN_CLI ?? resolve(process.env.LOCALAPPDATA, 'Obsidian/Obsidian.com');
const errors = []; context.on('weberror', error => { errors.push(error.error().message); });
const evaluateObsidian = code => {
  const output = execFileSync(cli, ['vault=p0-vault', 'eval', `code=${code}`], { encoding: 'utf8', windowsHide: true });
  assert.doesNotMatch(output, /^Error:/m); return output;
};
const setContentSettings = settings => evaluateObsidian(`(async()=>{if(!await app.plugins.plugins['ai-inbox'].changeSettings(${JSON.stringify(settings)}))throw new Error('Settings failed');return true})()`);
// Scope this controlled run to its marked test Vault and synthetic receiver.
// Other running user Vaults may be advertised, but are never selected or changed.
const scopeDiscovery = async (worker, ids) => worker.evaluate(ids => {
  globalThis.fixtureVaultIds = ids;
  if (globalThis.fixtureScopedFetch) return;
  globalThis.fixtureScopedFetch = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await original(...args);
    if (/^http:\/\/127\.0\.0\.1:\d+\/v1\/discovery$/.test(String(args[0])) && response.ok) {
      const value = await response.clone().json();
      if (!globalThis.fixtureVaultIds.includes(value.vaultId)) return new Response('{}', { status: 404 });
    }
    return response;
  };
}, ids);
try {
  setContentSettings({ includeThinking: false, includeTitle: false, language: 'zh' });
  let protocol = await context.browser().newBrowserCDPSession();
  await protocol.send('Extensions.loadUnpacked', { path: extension });
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  await scopeDiscovery(worker, [config.vaultId]);
  const extensionId = new URL(worker.url()).hostname;
  const chatId = randomUUID(); const userId = randomUUID(); const assistantId = randomUUID(); const commentaryId = randomUUID();
  const thinkingId = randomUUID();
  const marker = '\uE200cite\uE202turn0search0\uE201';
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOwaPr2HwAFVgKwVpOyIwAAAABJRU5ErkJggg==', 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex'); const title = `Browser alpha ${Date.now()}`;
  let answer = `Synthetic answer ${marker}\n\n\uE203Highlighted source text\uE204\n\nUnresolved source \uE200cite\uE202turn9search7\uE201\n\n\`literal [[note]]\`\n\n$E=mc^2$`;
  let invalidCitation = false;
  const source = () => ({ conversation_id: chatId, title, current_node: assistantId, update_time: 123,
    page_info: { start_cursor: userId, end_cursor: assistantId, has_previous_page: false, has_next_page: false },
    messages: [
      { id: userId, author: { role: 'user' }, channel: null, status: 'finished_successfully', metadata: { attachments: [{ name: 'Sample.pdf', mime_type: 'application/pdf', id: 'file-pdf' }] },
        content: { content_type: 'multimodal_text', parts: ['Synthetic question', { content_type: 'image_asset_pointer', asset_pointer: 'file-fixture', alt: 'Synthetic image' }] } },
      { id: thinkingId, author: { role: 'assistant' }, recipient: 'all', status: 'finished_successfully', metadata: { is_visually_hidden_from_conversation: true },
        content: { content_type: 'thoughts', thoughts: [{ summary: 'Synthetic thinking summary', content: 'Expanded thinking detail', finished: true }] } },
      { id: commentaryId, author: { role: 'assistant' }, channel: 'commentary', recipient: 'all', status: 'finished_successfully',
        content: { content_type: 'text', parts: ['Synthetic user-facing progress'] } },
      { id: assistantId, author: { role: 'assistant' }, channel: 'final', status: 'finished_successfully',
        content: { content_type: 'text', parts: [answer] }, metadata: { content_references: [{ type: 'webpage', matched_text: marker, items: [{ title: 'Example source', url: invalidCitation ? 'private-invalid-url' : 'https://example.org/source' }] }] } },
    ] });
  let imageRequests = 0; let conversationRequests = 0; let changeDuringImage = false; let failImage = false;
  const mockRoute = async route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/c/${chatId}`) await route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${title}</title>
      <h1>Synthetic conversation</h1><article data-message-author-role="user" data-message-id="${userId}">Synthetic question</article>
      <article data-message-author-role="assistant" data-message-id="${thinkingId}">Expanded thinking detail</article>
      <article data-message-author-role="assistant" data-message-id="${assistantId}">Synthetic answer</article>
      <script type="application/json">${JSON.stringify({ user: { id: 'fixture-user' }, expires: '2099-01-01', accessToken: 'synthetic-fixture-token' })}</script>
      <script>fetch('/backend-api/conversations/${chatId}?include_has_versions=true&num_turns=10').then(r=>r.json()).then(()=>document.body.dataset.ready='yes')</script>` });
    else if (url.pathname === `/backend-api/conversations/${chatId}`) { conversationRequests++; await route.fulfill({ contentType: 'application/json', body: JSON.stringify(source()) }); }
    else if (url.pathname === '/backend-api/files/download/file-fixture') {
      assert.equal(route.request().headers().authorization, 'Bearer synthetic-fixture-token');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ download_url: 'https://chatgpt.com/fixture.png' }) });
    } else if (url.pathname === '/fixture.png') {
      imageRequests++; assert.equal(route.request().headers().authorization, undefined);
      if (changeDuringImage) { answer += '\nChanged during capture'; changeDuringImage = false; }
      if (failImage) await route.fulfill({ status: 503, body: 'Synthetic image failure' });
      else await route.fulfill({ contentType: 'image/png', body: bytes });
    } else await route.abort();
  };
  await context.route('https://chatgpt.com/**', mockRoute);
  let options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  assert.equal(await options.locator('#connection').count(), 0);
  await options.locator(`[data-vault-id="${config.vaultId}"]`).waitFor();
  let pairingApproved = false;
  let chat = await context.newPage(); const url = `https://chatgpt.com/c/${chatId}`; await chat.goto(url); await chat.waitForSelector('body[data-ready=yes]');
  let tabId;
  let targetId = (await protocol.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.type === 'tab' && target.url === url).targetId;
  async function trigger(expectedAction, expectedStage = 'success', twice = false) {
    // Match the user's return from the vault chooser to the chat toolbar.
    // Chrome's openOptionsPage may otherwise leave the extension page active.
    await chat.bringToFront();
    targetId = (await protocol.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.type === 'tab' && target.url === url).targetId;
    if (tabId !== undefined) await options.evaluate(async tabId => { await chrome.storage.local.remove(`status:${tabId}`); }, tabId);
    worker ??= context.serviceWorkers()[0];
    const replacement = !worker ? context.waitForEvent('serviceworker', { timeout: 15000 }) : null;
    await protocol.send('Extensions.triggerAction', { id: extensionId, targetId });
    if (replacement) worker = await replacement;
    if (twice) await protocol.send('Extensions.triggerAction', { id: extensionId, targetId });
    tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    const deadline = Date.now() + 30000;
    let status;
    while (Date.now() < deadline) {
      status = await worker.evaluate(async tabId => (await chrome.storage.local.get(`status:${tabId}`))[`status:${tabId}`], tabId);
      if (status?.stage === 'pairing' && !pairingApproved) {
        assert.match(status.pairCode, /^\d{6}$/); assert.equal(status.vaultName, 'p0-vault');
        const approve = `(async()=>{await new Promise(r=>setTimeout(r,250));const matches=Array.from(activeDocument.querySelectorAll('.modal')).filter(el=>el.textContent.includes('连接 AI Inbox')&&el.textContent.includes(${JSON.stringify(status.pairCode)}));if(matches.length!==1)throw new Error('Expected one synthetic pairing modal');const button=Array.from(matches[0].querySelectorAll('button')).find(button=>button.textContent==='允许连接');if(!button)throw new Error('Pairing button missing');button.click();return true})()`;
        const result = execFileSync(cli, ['vault=p0-vault', 'eval', `code=${approve}`], { encoding: 'utf8', windowsHide: true }); assert.doesNotMatch(result, /^Error:/m); pairingApproved = true;
      }
      if (['success', 'error'].includes(status?.stage)) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(status?.stage, expectedStage, JSON.stringify(status));
    if (expectedStage === 'success') assert.equal(status.receipt.action, expectedAction); return status;
  }
  const first = await trigger('created'); assert.equal(first.receipt.messages, 3); assert.equal(first.receipt.images, 1);
  assert.equal(pairingApproved, true);
  await options.waitForFunction(() => document.querySelector('#current-vault').textContent === 'p0-vault');
  await options.screenshot({ path: join(testRoot, 'settings.png'), fullPage: true });
  await chat.waitForSelector('#ai-inbox-feedback'); await chat.screenshot({ path: join(testRoot, 'saved.png') });
  const text = await readFile(join(vault, first.receipt.path), 'utf8'); assert.ok(text.includes('https://example.org/source')); assert.ok(!text.includes(marker));
  assert.ok(text.includes('`literal [[note]]`')); assert.ok(text.includes('$E=mc^2$')); assert.ok(text.includes(sha256));
  assert.ok(text.includes('Synthetic user-facing progress'));
  assert.ok(text.includes('Highlighted source text')); assert.ok(!text.includes('\uE203'));
  assert.ok(text.includes('引用未解析')); assert.ok(text.includes('turn9search7'));
  assert.ok(text.indexOf('Synthetic user-facing progress') < text.indexOf('Synthetic answer'));
  assert.ok(text.includes('![Synthetic image]')); assert.ok(text.includes('Sample\\.pdf'));
  const assetPath = decodeURIComponent(/!\[[^\n]+\]\(<\/([^>]+)>\)/.exec(text)[1]); assert.equal(createHash('sha256').update(await readFile(join(vault, assetPath))).digest('hex'), sha256);
  assert.ok(!text.includes('Expanded thinking detail')); assert.ok(!text.includes(`# ${title}`));
  setContentSettings({ includeThinking: true, includeTitle: true, language: 'en' });
  const withThinking = await trigger('updated'); assert.equal(withThinking.receipt.messages, 4);
  const expanded = await readFile(join(vault, first.receipt.path), 'utf8');
  assert.ok(expanded.includes('> [!note]- Thinking')); assert.ok(expanded.includes('Expanded thinking detail'));
  assert.ok(expanded.includes(`# ${title}`)); assert.ok(expanded.includes('## User')); assert.ok(expanded.includes(sha256));
  const englishUI = evaluateObsidian(`(async()=>{app.setting.open();app.setting.openTabById('ai-inbox');await new Promise(r=>setTimeout(r,150));return JSON.stringify({english:app.setting.activeTab.containerEl.textContent.includes('Save thinking content')})})()`);
  assert.ok(englishUI.includes('"english":true'));
  setContentSettings({ includeThinking: false, includeTitle: false, language: 'zh' });
  const chineseUI = evaluateObsidian(`(async()=>{app.setting.openTabById('ai-inbox');await new Promise(r=>setTimeout(r,150));return JSON.stringify({chinese:app.setting.activeTab.containerEl.textContent.includes('保存思考内容')})})()`);
  assert.ok(chineseUI.includes('"chinese":true'));
  evaluateObsidian('app.setting.close()');
  await trigger('updated'); const reduced = await readFile(join(vault, first.receipt.path), 'utf8');
  assert.ok(!reduced.includes('Expanded thinking detail')); assert.ok(!reduced.includes(`# ${title}`));
  await trigger('unchanged'); answer += '\nNew source text'; await trigger('updated');
  const code = `(async()=>{const f=app.vault.getFileByPath(${JSON.stringify(first.receipt.path)});await app.vault.modify(f,(await app.vault.read(f))+"\\nLocal edit from browser test");return true})()`;
  const output = execFileSync(cli, ['vault=p0-vault', 'eval', `code=${code}`], { encoding: 'utf8', windowsHide: true }); assert.doesNotMatch(output, /^Error:/m);
  const fork = await trigger('forked'); assert.notEqual(fork.receipt.path, first.receipt.path);
  assert.ok((await readFile(join(vault, first.receipt.path), 'utf8')).endsWith('Local edit from browser test'));
  await chat.screenshot({ path: join(testRoot, 'forked.png') });
  // Lose only the POST response after the actual Obsidian commit, then restart
  // the entire isolated browser. The durable request must survive tab ID changes.
  answer += '\nBefore lost response';
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const result = await original(...args);
      if (String(args[0]).endsWith('/v1/save') && args[1]?.method === 'POST') { globalThis.fetch = original; throw new TypeError('Synthetic lost response'); }
      return result;
    };
  });
  await trigger(null, 'error');
  const stateBefore = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8')).writer;
  const revisionBefore = stateBefore.conversations[chatId].revision;
  console.log('Synthetic response loss confirmed; restarting the isolated browser.');
  await context.close(); context = await launch(); context.on('weberror', error => { errors.push(error.error().message); });
  protocol = await context.browser().newBrowserCDPSession();
  const installed = (await protocol.send('Extensions.getExtensions')).extensions;
  if (!installed.some(item => item.id === extensionId && item.enabled)) await protocol.send('Extensions.loadUnpacked', { path: extension });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await scopeDiscovery(worker, [config.vaultId]);
  await context.route('https://chatgpt.com/**', mockRoute);
  options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.evaluate(async tabId => { await chrome.storage.local.remove(`status:${tabId}`); }, tabId); tabId = undefined;
  chat = await context.newPage(); await chat.goto(url); await chat.waitForSelector('body[data-ready=yes]');
  targetId = (await protocol.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.find(target => target.type === 'tab' && target.url === url).targetId;
  const recovered = await trigger('updated'); assert.equal(recovered.receipt.revision, revisionBefore);
  const stateAfter = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8')).writer;
  assert.equal(stateAfter.conversations[chatId].revision, revisionBefore); assert.equal(Object.keys(stateAfter.notes).length, Object.keys(stateBefore.notes).length);
  changeDuringImage = true; const changedDuringCapture = await trigger(null, 'error'); assert.equal(changedDuringCapture.code, 'SOURCE_CHANGED');
  failImage = true; const failedImage = await trigger(null, 'error'); assert.equal(failedImage.code, 'ASSET_FETCH_FAILED'); failImage = false;
  invalidCitation = true;
  const failedCapture = await trigger(null, 'error');
  assert.equal(failedCapture.code, 'CITATION_URL_INVALID'); assert.equal(failedCapture.notSubmitted, true);
  assert.equal(failedCapture.diagnostics.validation.failedMessages[0].index, 3);
  const statusPage = await context.newPage(); await statusPage.goto(`chrome-extension://${extensionId}/status.html?tab=${tabId}`);
  await statusPage.locator('#copy').waitFor({ state: 'visible' });
  const diagnostic = await statusPage.locator('#diagnostics-text').textContent();
  for (const secret of [config.token, chatId, answer, 'private-invalid-url', 'https://example.org/source']) assert.ok(!diagnostic.includes(secret));
  assert.equal(JSON.parse(diagnostic).code, 'CITATION_URL_INVALID');
  await statusPage.locator('#diagnostics-label').click(); await statusPage.screenshot({ path: join(testRoot, 'capture-diagnostics.png'), fullPage: true });
  const stateAfterFailure = JSON.parse(await readFile(join(vault, '.obsidian/plugins/ai-inbox/data.json'), 'utf8')).writer;
  assert.equal(stateAfterFailure.conversations[chatId].revision, revisionBefore);
  await statusPage.close(); invalidCitation = false;
  const duplicateClick = await trigger('updated', 'success', true); assert.equal(duplicateClick.receipt.revision, revisionBefore + 1);
  // Hover keeps a successful result available past its normal timeout.
  await chat.locator('#ai-inbox-feedback').hover(); await new Promise(resolve => setTimeout(resolve, 6600));
  assert.equal(await chat.locator('#ai-inbox-feedback').count(), 1);
  await options.locator('#language').selectOption('en'); await options.emulateMedia({ colorScheme: 'dark' });
  await options.screenshot({ path: join(testRoot, 'settings-dark-en.png'), fullPage: true });
  // A second real protocol server with an in-memory synthetic Vault exercises
  // discovery, explicit selection and default routing without another user Vault.
  const modulePath = join(testRoot, 'test-receiver.mjs');
  await build({ stdin: { contents: "export { startInboxServer } from './spikes/transport/inbox-server'; export { InboxWriter } from './spikes/core/writer';", resolveDir: root },
    bundle: true, platform: 'node', format: 'esm', outfile: modulePath });
  const { startInboxServer, InboxWriter } = await import(pathToFileURL(modulePath).href);
  const secondId = randomUUID(); const files = new Map(); const images = new Map();
  const store = { read: async path => files.get(path) ?? null, create: async (path, text) => { files.set(path, text); },
    replace: async (path, expected, text, guard) => { assert.equal(files.get(path), expected); assert.ok(guard()); files.set(path, text); },
    editor: () => [], markdownPaths: () => [...files.keys()], readBinary: async path => images.get(path) ?? null,
    createBinary: async (path, bytes) => { images.set(path, bytes); }, attachmentPath: async filename => filename, saveState: async () => undefined };
  secondaryServer = await startInboxServer({ writer: new InboxWriter(store, null), vaultId: secondId, token: 'c'.repeat(64), vaultName: 'Synthetic second vault', confirmPair: async () => true });
  await scopeDiscovery(worker, [config.vaultId, secondId]);
  await options.evaluate(async () => await chrome.storage.local.remove(['connection', 'defaultVaultName']));
  const beforeChoice = conversationRequests;
  const needsChoice = await trigger(null, 'error'); assert.equal(needsChoice.code, 'VAULT_SELECTION_REQUIRED'); assert.equal(conversationRequests, beforeChoice);
  await options.locator('#refresh').click(); await options.locator(`[data-vault-id="${secondId}"]`).click();
  await options.waitForFunction(() => document.querySelector('#current-vault').textContent === 'Synthetic second vault');
  await trigger('created'); assert.equal(files.size, 1);
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('connection')).connection.vaultId), secondId);
  await options.screenshot({ path: join(testRoot, 'vault-selection.png'), fullPage: true });
  await options.locator(`[data-vault-id="${config.vaultId}"]`).click();
  await options.waitForFunction(() => document.querySelector('#current-vault').textContent === 'p0-vault');
  await trigger('unchanged');
  const selected = await options.evaluate(async () => await chrome.storage.local.get(['connection', 'connections', 'defaultVaultName']));
  const stopped = execFileSync(cli, ['vault=p0-vault', 'eval', 'code=(async()=>{await app.plugins.disablePlugin("ai-inbox");return true})()'], { encoding: 'utf8', windowsHide: true });
  assert.doesNotMatch(stopped, /^Error:/m); pausedReceiver = true;
  const beforeOffline = conversationRequests;
  const missingDefault = await trigger(null, 'error'); assert.equal(missingDefault.code, 'DEFAULT_VAULT_UNAVAILABLE'); assert.equal(files.size, 1);
  await secondaryServer.close(); secondaryServer = undefined;
  await options.evaluate(async () => await chrome.storage.local.remove(['connection', 'connections', 'defaultVaultName']));
  const offline = await trigger(null, 'error'); assert.equal(offline.code, 'OBSIDIAN_UNAVAILABLE');
  assert.equal(conversationRequests, beforeOffline);
  const jobs = await worker.evaluate(async () => await new Promise((resolve, reject) => {
    const opening = indexedDB.open('ai-inbox-jobs', 1); opening.onerror = () => reject(new Error('Queue unavailable'));
    opening.onsuccess = () => { const db = opening.result; const request = db.transaction('jobs', 'readonly').objectStore('jobs').count();
      request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => { db.close(); reject(new Error('Queue unavailable')); }; };
  }));
  assert.equal(jobs, 0);
  const restored = execFileSync(cli, ['vault=p0-vault', 'eval', 'code=(async()=>{await app.plugins.enablePluginAndSave("ai-inbox");return true})()'], { encoding: 'utf8', windowsHide: true });
  assert.doesNotMatch(restored, /^Error:/m); pausedReceiver = false;
  await options.evaluate(async selected => await chrome.storage.local.set(selected), selected);
  await trigger('unchanged');
  assert.equal(await worker.evaluate(async () => await chrome.action.getBadgeText({})), '');
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { at: new Date().toISOString(), passed: true, kind: 'packaged-extension-synthetic-browser-real-obsidian', discoveryScopedToTestVaults: true,
    contentSettingsApplied: true, thinkingDefaultExcluded: true, thinkingOptInCollapsed: true, titleDefaultExcluded: true, settingsChangeUpdatesSameSource: true, obsidianBilingualSettings: true, expandedThinkingDomIdsAccepted: true,
    settingsConnection: true, noManualConnectionEntry: true, initialPairingApproved: pairingApproved, captureMessages: 3, userFacingCommentaryPreserved: true, commentaryAbsentFromDomAccepted: true, imageBytesVerified: true, citationConverted: true,
    citationFormatMarkersHandled: true, unresolvedCitationPreserved: true,
    altPreserved: true, attachmentNamePreserved: true, noChange: true, sourceUpdate: true, localEditFork: true, lostResponseWorkerRestartRecovered: true, recoveryDidNotDuplicate: true,
    sourceRaceRejected: true, failedImageRejected: true, captureCausePreserved: true, diagnosticsSanitized: true, captureFailureDidNotCommit: true, duplicateClickDeduplicated: true, hoverPausesDismiss: true,
    fixedIconNoBadge: true, multipleVaultSelection: true, noDefaultRequiresChoice: true, selectionBecomesDefault: true, closedDefaultDoesNotReroute: true,
    offlineFailsWithoutCapture: true, offlineCreatesNoQueue: true, conversationRequests, imageRequests,
    screenshots: testRoot, realChatGPTVerified: false, activeTabToolbarGrantVerified: true };
  await mkdir(resolve(root, '.local/alpha-reports'), { recursive: true });
  await writeFile(resolve(root, '.local/alpha-reports/browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  if (secondaryServer) await secondaryServer.close();
  if (pausedReceiver) execFileSync(cli, ['vault=p0-vault', 'eval', 'code=(async()=>{await app.plugins.enablePluginAndSave("ai-inbox");return true})()'], { windowsHide: true });
  setContentSettings(originalContentSettings);
  await context.close();
}
