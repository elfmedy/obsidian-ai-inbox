# Changelog

## 0.5.2

- Support ChatGPT text alignment and sizing attributes, captions, and literal Link components.
- Preserve SVG diagrams and template loops as clearly labelled, inert source blocks so they no longer block conversation saves.
- Keep code examples, link validation, image checks and the final API recheck intact.
- 修复更多 ChatGPT 布局属性、说明文字、链接和 SVG 图示触发 HTML 不支持的问题；SVG 明确保留为源码块，暂不渲染。

## 0.5.1

- Convert supported ChatGPT cards, columns and flow layouts to Markdown while preserving text, code, images and arrows.
- Expand citations from source metadata; retain unresolved JSX citations with an explicit label.
- Keep unknown HTML checks and existing conversation, image and write protections.
- 修复包含已支持卡片、分栏或流程组件的 ChatGPT 对话无法保存的问题；保留代码、图片和箭头，无法解析的引用明确标注。

## 0.4.0

- Separate Obsidian and browser releases, with independent builds and compatibility checks.
- New English and Chinese product pages and user guides.
- Keep existing note protection, attachments, settings, pairing, and BRAT identity.

## 0.3.0

- Optional thinking summaries and body titles, both off by default.
- Follow Obsidian's language or choose English / simplified Chinese.

## 0.2.0

- Automatic local-vault discovery, first-connection approval, and default-vault switching.
- Save images using Obsidian's default attachment location.

Earlier combined releases, including the browser-only 0.3.1 fix, remain in [Releases](https://github.com/elfmedy/obsidian-ai-inbox/releases). Browser changes continue in [browser-ai-inbox](https://github.com/elfmedy/browser-ai-inbox/releases).
