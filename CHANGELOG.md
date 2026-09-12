# Changelog

## 0.2.0 — 2026-09-12

First public Alpha release, installable with BRAT from `elfmedy/obsidian-ai-inbox`.

- Save the complete current ChatGPT conversation branch and download images to Obsidian's configured attachment location.
- Preserve local edits by saving a new timestamped note. Update unedited notes; skip unchanged content.
- Discover running Vaults, confirm pairing in Obsidian once, and remember or switch the default Vault.
- Fail clearly when Obsidian or the default Vault is unavailable; no offline capture queue or automatic launch.
- Convert supported citations to links; retain unresolved citation markers with explicit labels.
- Redesigned Chrome toolbar icon, save feedback, and bilingual settings.

Validation: 162 automated tests, official Obsidian lint, strict TypeScript, deterministic builds, license inventory, and controlled browser / real Obsidian integration. Real long conversations, generated images, and branch scenarios remain acceptance items. Desktop only; tested on Windows with Obsidian 1.13.7, minimum declared version 1.12.0.
