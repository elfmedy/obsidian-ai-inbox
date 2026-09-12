# Building and contributing

Use Node.js 24 and Python 3. Clone this repository and run:

```sh
npm ci
npm run check
python scripts/package.py
```

The checked build is in `dist/obsidian-plugin`. Release assets and SHA-256 checksums are in `dist/releases/`. No sibling checkout, private document, test vault, or globally installed library is required. Tests use synthetic data. `npm run check` covers lint, strict types, tests, release file inventory, license inclusion, protocol hashes, and a repeat build.

## Source layout

`src/obsidian/` contains the entry points and UI. `src/core/` and `src/transport/` implement protected writes and the local receiver. `src/render/` handles Markdown and citations. Public types and validation live in `src/shared/` and `src/core/schema.ts`.

## Companion compatibility

The companion is [elfmedy/browser-ai-inbox](https://github.com/elfmedy/browser-ai-inbox). Each repository owns its build and version. `protocol/contract.json` pins identical wire definitions, and `protocol/save-example.json` supplies a shared example tested on both sides. Changes to a pinned file fail checks until its compatibility has been reviewed and the hash deliberately updated. Compare contract files in the companion before releasing protocol changes. Hashes are a review guard, not automatic cross-repository synchronization; no third package or Git submodule is required.

Preserve existing protocol-v1 clients unless a migration is explicitly documented. Shared rendering utilities are vendored in both projects; carry relevant fixes and tests to both. Keep original third-party notices when adapting code.

## Releasing

Update this repository's `manifest.json`, `package.json`, `package-lock.json` and `versions.json`. Add a short bilingual, user-facing note in `.github/release-notes/<version>.md` and update `CHANGELOG.md`. Run the checks and inspect the exact staged files. Push the source, wait for the Check workflow, then push the matching numeric tag (for example `0.4.0`, without a `v`). The Release workflow checks, packages, and publishes this component only.

Release notes describe features or fixes, update instructions, and the minimum compatible companion. The Alpha label remains explicit even though releases are discoverable as the latest release. Do not add internal plans, local paths, account data, tokens, generated test reports, or private screenshots. Product documentation and synthetic demonstration images belong in `docs/`; local investigation material belongs in ignored `.local/`.
