# Changelog

## 0.3.0 — 2026-09-12

- Add per-Vault thinking export (off by default), using collapsed callouts for recognized ChatGPT thinking summaries and activities.
- Add a body-title option (off by default), preserving filenames and headings inside original answers.
- Add Simplified Chinese / English plugin UI with Follow Obsidian as the default, including pairing, notices, and generated note labels.
- Apply content settings on the next save even when source content is unchanged; preserve local edits in timestamped copies.
- Fetch target-Vault export preferences before capture and reject stale settings before a new write. Already committed retries still return the same receipt.
- Preserve existing credentials and writer indexes when upgrading. Both plugin and Chrome extension should be updated to 0.3.0.

Validation: 176 automated tests, official lint, strict TypeScript, deterministic packaging, synthetic ChatGPT browser / real Obsidian integration, and native language/toggle controls on Obsidian 1.13.7. The current user's real expanded-thinking sample has not been independently inspected; adapter behavior is covered with synthetic fixtures matching the pinned upstream shapes.

## 0.2.0 — 2026-09-12

First public Alpha release, installable with BRAT from `elfmedy/obsidian-ai-inbox`.

- Save the complete current ChatGPT conversation branch and download images to Obsidian's configured attachment location.
- Preserve local edits by saving a new timestamped note. Update unedited notes; skip unchanged content.
- Discover running Vaults, confirm pairing in Obsidian once, and remember or switch the default Vault.
- Fail clearly when Obsidian or the default Vault is unavailable; no offline capture queue or automatic launch.
- Convert supported citations to links; retain unresolved citation markers with explicit labels.
- Redesigned Chrome toolbar icon, save feedback, and bilingual settings.

Validation: 162 automated tests, official Obsidian lint, strict TypeScript, deterministic builds, license inventory, and controlled browser / real Obsidian integration. Real long conversations, generated images, and branch scenarios remain acceptance items. Desktop only; tested on Windows with Obsidian 1.13.7, minimum declared version 1.12.0.
