<p align="center"><img src="docs/assets/ai-inbox.svg" width="64" height="64" alt="AI Inbox"></p>
<h1 align="center">AI Inbox for Obsidian</h1>
<p align="center"><strong>Keep your ChatGPT conversations in your notes.</strong></p>
<p align="center">Save conversations and images as editable Markdown, with the companion browser extension.</p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a><br><a href="#features">Features</a> · <a href="#install">Install</a> · <a href="https://github.com/elfmedy/browser-ai-inbox">Browser extension</a></p>

![A saved example conversation in Obsidian.](docs/assets/note-preview.png)

## Features

- **Keep the conversation.** Save all messages on the current conversation branch as ordinary Markdown.
- **Keep images locally.** Images follow your vault's default attachment location and remain available offline.
- **Keep your edits.** Save again to update an untouched note. If you edited its body, AI Inbox creates a dated copy.
- **Choose the content.** Thinking summaries and the extra title inside the note are optional; both default to off.
- **Use your language.** Follow Obsidian, or choose English or simplified Chinese.

## Install

AI Inbox needs **both this Obsidian plugin and the [browser extension for Chrome / Edge](https://github.com/elfmedy/browser-ai-inbox#install)** on the same computer.

1. Install and enable **BRAT** in Obsidian.
2. In BRAT, choose **Add Beta plugin**, enter `elfmedy/obsidian-ai-inbox`, then enable **AI Inbox**.
3. [Install the browser extension](https://github.com/elfmedy/browser-ai-inbox#install).

Requires **Obsidian desktop 1.12.0+**. Currently Alpha; not listed in the community plugin directory. Windows is the primary tested platform.

<details><summary>Manual installation</summary>

Download `main.js` and `manifest.json` from the [latest release](https://github.com/elfmedy/obsidian-ai-inbox/releases/latest), place them in `.obsidian/plugins/ai-inbox/` inside your vault, and enable the plugin. No `styles.css` is required.

</details>

## Start saving

1. Keep your destination vault open in Obsidian.
2. Open a ChatGPT conversation in Chrome or Edge, wait for the reply to finish, and click **AI Inbox**.
3. Confirm the first connection in Obsidian. Your conversation appears in **AI Inbox/**.

With multiple vaults, choose a destination once to make it the default. Right-click the browser extension icon to switch later. If Obsidian or the default vault is closed, saving fails with a clear message.

## Make it yours

Open **Settings → AI Inbox** to choose the note folder, thinking summaries, the title inside notes, and the interface language. Images use **Settings → Files and links → Default location for new attachments**.

Settings apply on the next save; existing notes are not rewritten in bulk. See the [user guide](docs/guide.md) for save rules, privacy, and troubleshooting.

## Updates

Update this plugin through BRAT. Update the [browser extension](https://github.com/elfmedy/browser-ai-inbox/releases/latest) separately; release notes say when both sides need an update. Version **0.4.0** works with browser extension **0.3.0+**.

The browser project moved to its own repository in 0.4.0. Existing BRAT installations keep the same repository and plugin ID.

---

[Report an issue](https://github.com/elfmedy/obsidian-ai-inbox/issues) · [Releases](https://github.com/elfmedy/obsidian-ai-inbox/releases) · [Build from source](CONTRIBUTING.md) · [MIT license](LICENSE)
