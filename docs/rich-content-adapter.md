# ChatGPT presentation components

## Reference implementations and decision

The following source files were reviewed when choosing the conversion strategy:

- [Pionxzh/chatgpt-exporter: Markdown exporter](https://github.com/pionxzh/chatgpt-exporter/blob/4c8fe6ea01d58a59bc59aea9ba1421fee7d80969/src/exporter/markdown.ts) and [Markdown utilities](https://github.com/pionxzh/chatgpt-exporter/blob/4c8fe6ea01d58a59bc59aea9ba1421fee7d80969/src/utils/markdown.ts): start with API message content, expand citation metadata, and protect math before Markdown processing. Its general Markdown round trip is broader than AI Inbox's source-preserving edits.
- [rashidazarang/chatgpt-chat-exporter: extraction engine](https://github.com/rashidazarang/chatgpt-chat-exporter/blob/2882af2aa03103be31dc8ef448e49cae593e19f7/src/extraction-engine.js): `payloadMessageToExport` uses the original Markdown and resolves citations; the separate DOM path protects code and other verbatim regions. This supports keeping the API branch authoritative for Markdown exports.
- [volker48/chatgpt-md: content script](https://github.com/volker48/chatgpt-md/blob/cae389ba0709359966a4cdbe951721da7196d746/entrypoints/content.ts): converts rendered articles with Turndown. This is compact for visible DOM content, but does not solve API Markdown containing JSX-like layout attributes or absent/virtualized messages.

These inspected paths did not supply an adapter for the observed `grid`/`box` vocabulary. The new adapter is original code; the existing citation implementation retains its upstream attribution.

AI Inbox keeps API Markdown as the source and applies a narrow presentation adapter before citation expansion and image discovery. It does not convert the entire response through HTML, strip arbitrary tags, or fall back to a partial DOM capture. Those alternatives can lose code indentation, image references, citations, or conversation coverage.

## Conversion boundary

- Standalone, balanced `grid`, `grid-item`, `box`, and `row` containers become sequential Markdown blocks, preserving source order. Their contents lose only common layout indentation. Columns, colors and card styling are not reproduced.
- Single-line `text` wrappers retain their Markdown contents. Known directional `icon` values become arrows.
- Only known presentation attributes are accepted; their values are scanned as inert strings, never evaluated. Unknown attributes, unknown icons, malformed or excessively nested components stop the export.
- Code, inline code and math examples remain literal. Ordinary Markdown outside adapted components is not serialized or reformatted.
- After conversion, the existing Markdown parser discovers images, canonicalizes downloaded assets, and escapes source wiki links. Unknown HTML, including raw HTML images, still requires a separate adapter.
- Citation metadata is applied first. Remaining `Cite ref`/`Cite refs` markers use the existing explicit unresolved-citation policy: keep the complete marker in an inert code span and label it. Source URLs are never inferred from opaque reference IDs.

The same renderer and regression tests are maintained in both repositories. The browser writes ordinary Markdown into the existing protocol-v1 snapshot, so this change does not require a wire-format migration.

## Verification

Synthetic tests cover nested columns and diagrams, code indentation, CRLF preservation, literal markup in code/math, image discovery and localization, reference images, wiki links, resolved/unresolved citations, idempotence, malformed tags, unknown attributes, and bounded nesting. Browser integration tests cover the final API recheck and snapshot creation. Private or shared conversation bodies are not checked into fixtures.
