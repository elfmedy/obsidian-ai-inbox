import { describe, expect, it } from 'vitest';
import { adaptRichLayout } from '../src/render/rich-layout';
import { canonicalizeImages, inspectMarkdown, localizeMarkdown } from '../src/render/markdown';
import { expandCitations, readReferences } from '../src/render/citations';
import { imageManifest, renderConversation } from '../src/render/conversation';

const layout = [
  '<grid columns={2} gap={3}>',
  '  <grid-item>',
  '    <box border radius="lg" padding={3} gap={2}>',
  '      **Configuration**',
  '',
  '      ```c',
  '      const Config cfg = {',
  '          .baudrate = 9600,',
  '      };',
  '      ```',
  '',
  '      <text size="xs" color="secondary">Keep **types** and `code`.</text>',
  '    </box>',
  '  </grid-item>',
  '  <grid-item>',
  '    <box border={{size:1,color:"rgba(22,163,74,0.25)"}}>',
  '      ![Diagram](https://example.org/diagram.png?sig=secret)',
  '    </box>',
  '  </grid-item>',
  '</grid>',
].join('\n');

describe('ChatGPT presentation component adapter', () => {
  it('flattens nested columns without losing code, Markdown or content order', () => {
    const output = adaptRichLayout(layout);
    expect(output).toContain('**Configuration**');
    expect(output).toContain('```c\nconst Config cfg = {\n    .baudrate = 9600,\n};\n```');
    expect(output).toContain('Keep **types** and `code`.');
    expect(output).not.toMatch(/<\/?(?:grid|box|text)/);
    expect(output.indexOf('Configuration')).toBeLessThan(output.indexOf('![Diagram]'));
    expect(adaptRichLayout(output)).toBe(output);
  });

  it('preserves surrounding CRLF, tables, whitespace, TeX and literal examples', () => {
    const before = '# Heading\r\n\r\n| a | b |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\n';
    const after = '\r\n\r\n`<box>sample</box>` and $<text>x</text>$  \r\n';
    const output = adaptRichLayout(before + layout.replaceAll('\n', '\r\n') + after);
    expect(output.startsWith(before)).toBe(true); expect(output.endsWith(after)).toBe(true);
    expect(output).toContain('```c\r\nconst Config cfg = {\r\n    .baudrate = 9600,\r\n};\r\n```');
    const examples = '    <box>indented code</box>\n\n```jsx\n' + layout + '\n```';
    expect(adaptRichLayout(examples)).toBe(examples);
  });

  it('keeps arrows and text in sequential diagrams', () => {
    const input = '<box>\n  <text weight="medium">Start</text>\n  <row justify="center">\n    <icon name="arrow-down" color="secondary"/>\n  </row>\n  <box>\n    **Finish**\n  </box>\n</box>';
    const output = localizeMarkdown(input, new Map());
    expect(output).toMatch(/Start\s+↓\s+\*\*Finish\*\*/);
  });

  it('does not mistake closing-tag examples in nested code or math for container ends', () => {
    const input = '<box>\n  <box>\n    ```html\n    </box>\n    <script>example</script>\n    ```\n\n    $$\n    </box>\n    $$\n  </box>\n</box>';
    const output = localizeMarkdown(input, new Map());
    expect(output).toContain('```html\n</box>\n<script>example</script>\n```');
    expect(output).toContain('$$\n</box>\n$$');
  });

  it('discovers and localizes component images through the existing asset pipeline', () => {
    const reference = 'https://example.org/diagram.png?sig=secret';
    const messages = [{ id: 'a', role: 'assistant' as const, parts: [{ type: 'text' as const, text: layout }] }];
    expect(imageManifest(messages)).toEqual([{ reference, messageIds: ['a'] }]);
    expect(() => canonicalizeImages(layout, new Map())).toThrow('not downloaded');
    const snapshot = canonicalizeImages(layout, new Map([[reference, 'a'.repeat(64)]]));
    expect(snapshot).not.toContain('sig=secret');
    const body = renderConversation({ title: 'Fixture', sourceUrl: 'https://chatgpt.com/c/fixture',
      messages: [{ ...messages[0]!, parts: [{ type: 'text', text: snapshot }] }],
      assets: new Map([['ai-inbox-asset:' + 'a'.repeat(64), 'assets/a.png']]) });
    expect(body).toContain('![Diagram](</assets/a.png>)');
    expect(body).toContain('    .baudrate = 9600,');
  });

  it('reparses bodies so reference images, wiki links and citations cannot hide in HTML', () => {
    const input = '<box>\n  ![Diagram][pic]\n\n  [pic]: https://example.org/a.png?sig=secret\n\n  [[note]]\n</box>';
    const snapshot = canonicalizeImages(input, new Map([['https://example.org/a.png?sig=secret', 'b'.repeat(64)]]));
    expect(snapshot).not.toContain('sig=secret');
    expect(localizeMarkdown(snapshot, new Map([['ai-inbox-asset:' + 'b'.repeat(64), 'assets/b.png']]))).toContain('\\[\\[note]]');
    expect(inspectMarkdown('<box>\n  ```md\n  ![not an asset](https://example.org/code.png)\n  ```\n</box>').images).toEqual([]);
  });

  it.each([
    '<box>\ntext', '<box>\ntext\n</grid>', '<box onClick="run()">\ntext\n</box>',
    '<box src="https://example.org">\ntext\n</box>', '<box>\n<img src="https://example.org/a.png">\n</box>',
    '<box>\n<script>alert(1)</script>\n</box>', '<icon name="unknown"/>', '<text>unclosed',
    '<box gap={broken>\ntext\n</box>', '<box {...props}>\ntext\n</box>',
  ])('fails closed for malformed, active or unknown markup: %s', input => {
    expect(() => localizeMarkdown(input, new Map())).toThrow('HTML');
  });

  it('bounds nesting', () => {
    expect(() => adaptRichLayout('<box>\n'.repeat(40) + 'text\n' + '</box>\n'.repeat(40))).toThrow();
  });

  it('expands known JSX citations and labels unresolved citations without inventing URLs', () => {
    const known = '<Cite ref="turn0search0"/>';
    const unknown = '<Cite refs={["turn0search1","turn0search2"]}/>';
    const refs = readReferences({ content_references: [{ type: 'webpage', matched_text: known,
      items: [{ title: 'Paper', url: 'https://example.org/paper' }] }] });
    const input = `<box>\n  Claim ${known} ${unknown}\n\n  \`\`\`jsx\n  ${known}\n  \`\`\`\n</box>`;
    const output = expandCitations(input, refs);
    expect(output).toContain('[Paper](<https://example.org/paper>)');
    expect(output).toContain('〔引用未解析：'); expect(output).toContain(unknown);
    expect(output).toContain('```jsx\n' + known + '\n```');
    expect(() => localizeMarkdown(output, new Map())).not.toThrow();
    expect(expandCitations(output, refs)).toBe(output);
  });
});
