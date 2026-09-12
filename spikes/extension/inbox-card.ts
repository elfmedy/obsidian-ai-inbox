import type { Feedback } from './inbox-types';
import { feedbackText } from './inbox-text';
import { diagnosticText } from './inbox-diagnostics';
declare global { var aiInboxCardInstalled: boolean | undefined; }
if (!globalThis.aiInboxCardInstalled) {
  globalThis.aiInboxCardInstalled = true;
  const host = document.createElement('div'); host.id = 'ai-inbox-feedback';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483647;font-family:system-ui,sans-serif;color-scheme:light dark}
  section{box-sizing:border-box;width:min(380px,calc(100vw - 32px));padding:20px;border:1px solid #d5d9d8;border-radius:14px;background:#fff;color:#202522;box-shadow:0 8px 40px #0002;font-size:14px;line-height:1.55}
  header{display:flex;justify-content:space-between;gap:16px;align-items:center}strong{font-size:15px}p{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
  nav{display:flex;gap:16px;align-items:center;margin-top:14px}a,button{font:inherit;color:#32674e}button{border:0;background:transparent;cursor:pointer;padding:4px}a{text-decoration:none}button:focus-visible,a:focus-visible{outline:2px solid #32674e;outline-offset:2px}
  small{display:block;margin-top:8px;color:#68756e;font-size:11px;overflow-wrap:anywhere}
  @media(prefers-color-scheme:dark){section{background:#222825;color:#f0f3f1;border-color:#49554d}a,button{color:#acd5be}small{color:#bbc9c1}}`;
  root.append(style);
  let remaining = 0; let hovered = false; let focused = false; let timer: ReturnType<typeof setInterval> | undefined; let last = 0;
  let pageUrl = location.href;
  function dismiss() { host.remove(); if (timer) clearInterval(timer); timer = undefined; }
  setInterval(() => { if (host.isConnected && location.href !== pageUrl) dismiss(); }, 500);
  host.addEventListener('mouseenter', () => { hovered = true; }); host.addEventListener('mouseleave', () => { hovered = false; });
  root.addEventListener('focusin', () => { focused = true; }); root.addEventListener('focusout', () => { focused = false; });
  chrome.runtime.onMessage.addListener((message: { type?: string; data?: Feedback; language?: string }, sender) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'feedback' || !message.data) return;
    const data = message.data;
    if (data.pageUrl && data.pageUrl !== location.href) { dismiss(); return; }
    pageUrl = data.pageUrl ?? location.href;
    const zh = message.language === 'zh' || (message.language !== 'en' && navigator.language.startsWith('zh'));
    root.querySelector('section')?.remove(); const section = document.createElement('section');
    section.setAttribute('role', data.stage === 'error' ? 'alert' : 'status'); section.setAttribute('aria-live', 'polite');
    const header = document.createElement('header'); const title = document.createElement('strong'); title.textContent = 'AI Inbox';
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', zh ? '关闭' : 'Dismiss'); close.onclick = dismiss;
    header.append(title, close); const text = document.createElement('p'); text.textContent = feedbackText(data, zh); section.append(header, text);
    if (data.code) { const code = document.createElement('small'); code.textContent = data.code; section.append(code); }
    if (data.stage === 'error') {
      const nav = document.createElement('nav'); const copy = document.createElement('button');
      copy.textContent = zh ? '复制诊断' : 'Copy diagnostics';
      copy.onclick = () => {
        void navigator.clipboard.writeText(diagnosticText(data, chrome.runtime.getManifest().version))
          .then(() => { copy.textContent = zh ? '已复制' : 'Copied'; })
          .catch(() => { copy.textContent = zh ? '复制失败，请从扩展最近状态页复制' : 'Copy from the extension status page'; });
      };
      nav.append(copy); section.append(nav);
    }
    if (data.stage === 'success' && data.receipt && data.vaultName) {
      const nav = document.createElement('nav'); const open = document.createElement('a'); open.textContent = zh ? '在 Obsidian 中打开' : 'Open in Obsidian';
      open.href = `obsidian://open?vault=${encodeURIComponent(data.vaultName)}&file=${encodeURIComponent(data.receipt.path)}`; nav.append(open); section.append(nav);
    }
    root.append(section); if (!host.isConnected) document.documentElement.append(host);
    if (timer) clearInterval(timer); timer = undefined;
    if (data.stage === 'success') {
      remaining = data.receipt?.action === 'forked' ? 8000 : 6000; last = performance.now();
      timer = setInterval(() => { const now = performance.now(); const elapsed = Math.min(500, now - last); last = now;
        if (!hovered && !focused && !document.hidden) remaining -= elapsed;
        if (remaining <= 0) dismiss();
      }, 200);
    }
  });
}
