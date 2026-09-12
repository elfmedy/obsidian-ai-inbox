# Third-party code and attribution

AI Inbox's original code is MIT licensed, copyright 2026 elfmedy. The following
upstream implementations informed adapted portions of the P0 capture code.
Their notices apply to those portions; original authorship is not reassigned.

## chatgpt-conversation-export

- Author: Thierry Abalea. License: MIT, copyright 2026 Thierry Abalea.
- Source: https://github.com/ThierryAbalea/chatgpt-conversation-export
- Revision: `543a98a3f6cfb0f59ad23cd1c0b6d070f4e98324`.
- Upstream file: `extension/popup.js`, preceding-page collection inside `fetchConversation`.
- Adaptation: `spikes/capture/paginated-messages.ts` and the pagination integration
  in `spikes/capture/observed-request.ts`.
- Changes: TypeScript module; injected bounded requests; identity, branch, page
  boundaries, overlap, size and progress checks; final head reread; no bulk export
  or raw JSON download; assembled coverage derived from validated page boundaries.
- Full license: `third-party/chatgpt-conversation-export.LICENSE`.

## chatgpt-exporter

- Thinking support in `spikes/capture/thinking.ts` also uses the same pinned
  `src/api.ts` thought/recap shapes and `reasoning_title` classification from
  `attachThinkingToNodes`. Changes: bounded unknown-input parsing, explicit
  per-Vault opt-in, collapsed Markdown callouts, expanded UI identity handling,
  and strict separation from raw analysis / tool input and output. The existing
  MIT license below applies; thinking support was checked with synthetic fixtures.

- Author: Pionxzh. License: MIT, copyright 2022-Present Pionxzh.
- Source: https://github.com/pionxzh/chatgpt-exporter
- Revision: `d0f44aae9d5650852b2979bbf830590b41f7b804`.
- Upstream file: `src/api.ts`, tool image detection in `shouldSkipMessageInExport`,
  `fetchImageFromPointer` and `fileDownloadApi`.
- Adaptation: `spikes/capture/image-parts.ts`, message classification, and the
  candidate `spikes/assets/chatgpt-image.ts` downloader.
- Changes: unknown-input validation; typed image extraction; bounded downloads;
  redirect refusal; no credential forwarding to CDN; P0 tool image adapter remains
  opt-in until live validation. No upstream UI copied.
- Full license: `third-party/chatgpt-exporter.LICENSE`.
- Additional upstream file: `src/utils/citations.ts`, adapted as
  `spikes/render/citations-upstream.ts`. Changes preserve original typography,
  whitespace and unresolved markers; the wrapper excludes code/TeX and bounds
  and validates metadata URLs. This adaptation is integrated in the alpha capture.
- Alpha 0.1.3 restores upstream U+E203/U+E204 normalization on both content and
  matched references. Unlike upstream's residual-marker deletion, unresolved
  markers remain labeled, inert literal text with exact Unicode escapes; no
  source URL is inferred. Source typography and original code/TeX are preserved.
- User-facing `commentary` retention follows `shouldSkipMessageInExport` and
  channel handling in `mergeContinuationNodes` in `src/api.ts`. AI Inbox keeps
  original message IDs/order rather than merging adjacent assistant records;
  hidden/reasoning/tool-directed messages remain excluded.

## OwlCt/ChatGPT-Export

- License: MIT, copyright 2026 huhu.
- Source: https://github.com/OwlCt/ChatGPT-Export
- Revision: `ea52daa231c877fafce9d849b390a64fa03ca349`.
- Upstream file: `Tampermonkey.js`, nested/flat image inspection,
  `normalizeAssetId`, `resolveFileDownloadUrl` and `fetchImageBlob`.
- Adaptation: image/attachment inspection in `spikes/capture/image-parts.ts` and
  the second resolver route in `spikes/assets/chatgpt-image.ts`.
- Changes: strict reference syntax, finite 404/405 route fallback, bounded JSON
  and bytes, HTTPS destination checking, no silent skip-on-error or URL logging.
- Attachment compatibility also adapts `inspectFileAttachment`: `file_name`,
  nested `file`, MIME aliases, and stable identifiers for unnamed attachments.
- Full license: `third-party/owlct-export.LICENSE`.

## Pinned Markdown dependencies

`mdast-util-from-markdown` 2.0.3, `mdast-util-gfm` 3.1.0,
`micromark-extension-gfm` 3.0.0, `mdast-util-math` 3.0.0 and
`micromark-extension-math` 3.1.0 support the independent body renderer.
All are MIT licensed. Their transitive versions are locked in package-lock.json;
complete non-dev dependency license texts are generated into
`third-party/npm-dependencies.txt` and included in both build directories.
The renderer is connected to the alpha browser/writer entry points. P0 remains a
separate diagnostic build. `zod` 4.6.2 (MIT) validates snapshots, local state and
protocol input; its full license is included in the generated dependency notices.

Other projects in `docs/open-source-review.md` were reviewed only. They are not
bundled dependencies or copied code. Adding them requires updating this inventory.
Builds include this notice and the above full licenses. Product marks/icons are
not included in these adaptations.
