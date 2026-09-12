# Using AI Inbox

## What gets saved

AI Inbox saves the complete **current branch** of an ordinary ChatGPT conversation. Regenerated alternatives outside that branch are not combined into the note. Save after the reply finishes. Code, supported mathematics and citations are preserved; downloaded images use local paths. Other attachment types and unsupported response formats may stop a save with an explanation.

## Saving again

- Unchanged source and unchanged local body: no duplicate note.
- Changed source and untouched local body: update the existing note.
- Edited local body: create a dated copy, even if the source did not change. The new copy becomes the target of later saves.
- Changed export settings: apply them on the next save, retaining the same protection for local edits.

Existing frontmatter is preserved on updates. Concurrent edits or uncertain source completeness stop the operation rather than overwrite unverified content. Existing local edits are not merged automatically.

## Content and attachments

In Obsidian **Settings → AI Inbox**, choose the note directory and language. **Save thinking content** exports recognized expanded thinking summaries in a collapsed callout; it is off by default. **Show conversation title in note** controls only the extra generated title and is also off by default. The filename and headings inside replies remain.

Images follow Obsidian's default attachment location, including the note's folder or a subfolder. Changing that setting applies to newly stored images; it does not relocate existing attachments. Chat text is never translated by the language setting.

## Connection and privacy

Both components must run on the same computer. The receiver binds only to `127.0.0.1`. The first connection requires approval in Obsidian. Choose a default vault once; use the extension's settings to switch it. A closed default vault does not silently redirect a save to another vault.

The browser reads the current ChatGPT conversation and downloads its images when you save. ChatGPT requests use the signed-in page session; AI Inbox has no hosted sync service or telemetry. Notes and images go to your local vault. Browser settings retain pairing information. An already-started save with an uncertain result may retain its pending request and image bytes locally until a retry confirms the result; this is not an offline capture queue. If Obsidian is unavailable before capture, saving fails immediately.

## Troubleshooting

- **Cannot connect:** open the intended Obsidian vault and enable AI Inbox. Check whether a firewall or proxy blocks local connections.
- **Need another vault:** right-click the extension icon and choose **Switch vault / Settings**.
- **Conversation changed or not fully loaded:** refresh ChatGPT, wait for the complete reply, then save again.
- **Result not confirmed:** keep the original vault open and retry. AI Inbox checks an existing receipt before resubmitting.
- **Unsupported content:** copy the diagnostic report for an issue. Do not include connection tokens or private conversation text.
- **Repeated old extension error:** reload the updated extension, clear old error entries, and check for new entries.

## Compatibility

This is an Alpha release, primarily tested on Windows with Obsidian 1.13.7. The manifest requires Obsidian 1.12.0+. Ordinary chats and uploaded images have been exercised; very long histories, generated images, and all ChatGPT branch variants do not yet have comprehensive real-account coverage. Chrome and Edge use the same Chromium extension package. Mobile Obsidian, Firefox and Safari are not supported.

The two components use protocol version 1 and can be updated independently while compatible. Both 0.4.0 components accept their 0.3.0+ companion. Future breaking changes will list the required companion version in the release notes.

[Companion project](https://github.com/elfmedy/browser-ai-inbox) · [Home](../README.md)
