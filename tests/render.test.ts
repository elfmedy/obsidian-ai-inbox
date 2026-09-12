import { describe, expect, it } from 'vitest';
import { inspectMarkdown, localizeMarkdown, canonicalizeImages } from '../spikes/render/markdown';
import { imageManifest, renderConversation } from '../spikes/render/conversation';
import type { GraphMessage } from '../spikes/capture/graph';

const textMessage = (id: string, text: string): GraphMessage => ({ id, role: 'user', parts: [{ type: 'text', text }] });
describe('upstream Markdown parser based source preservation', () => {
  it('removes signed image definitions from the durable snapshot without rewriting other Markdown', () => {
    const address = 'https://files.oaiusercontent.com/image.png?sig=secret'; const digest = 'a'.repeat(64);
    const input = `Hello  \n\n![Example][image]\n\n[image]: ${address}\n\n\`![not an image](literal)\``;
    const output = canonicalizeImages(input, new Map([[address, digest]]));
    expect(output).not.toContain('sig=secret'); expect(output).toContain(`![Example](ai-inbox-asset:${digest})`);
    expect(output).toContain('Hello  \n'); expect(output).toContain('`![not an image](literal)`');
    expect(() => canonicalizeImages(input + '\n[link][image]', new Map([[address, digest]]))).toThrow();
  });
  it('preserves fences, tables, list indentation, hard breaks and TeX byte-for-byte', () => {
    const markdown = '# title\r\n\r\n- first  \r\n  second\r\n\r\n|a|b|\r\n|-|-|\r\n|1|2|\r\n\r\n````md\r\n```js\r\n![[code]]\r\n```\r\n````\r\n\r\n$$\r\n[[a,b]]\r\n$$\r\n\r\n`[[inline]]` and $[[x]]$';
    expect(localizeMarkdown(markdown, new Map())).toBe(markdown);
  });
  it('escapes source wiki links only in normal text, keeping code and existing escapes intact', () => {
    const input = '[[note]] ![[image]] \\[\\[escaped]] `[[code]]` $[[math]]$';
    expect(localizeMarkdown(input, new Map())).toBe('\\[\\[note]] !\\[\\[image]] \\[\\[escaped]] `[[code]]` $[[math]]$');
  });
  it('resolves inline and reference images via the parsed tree while preserving ordinary links', () => {
    const input = '[link](https://example.com) ![alt](https://example.com/a.png)\n\n![again][PIC]\n\n[pic]: https://example.com/a.png "title"';
    const parsed = inspectMarkdown(input);
    expect(parsed.images.map(image => image.reference)).toEqual(['https://example.com/a.png', 'https://example.com/a.png']);
    const output = localizeMarkdown(input, new Map([['https://example.com/a.png', 'AI Inbox/assets/a.png']]));
    expect(output).toContain('[link](https://example.com) ![alt](</AI%20Inbox/assets/a.png>)');
    expect(output).toContain('![again](</AI%20Inbox/assets/a.png>)');
  });
  it('never treats image syntax inside code or TeX as a downloadable asset', () => {
    expect(inspectMarkdown('`![a](https://a.test)`\n\n```md\n![b](https://b.test)\n```\n\n$![x](y)$').images).toEqual([]);
  });
  it('refuses unresolved assets, unsafe paths, HTML and unsupported citation markers', () => {
    expect(() => localizeMarkdown('![a](https://example.com/a.png)', new Map())).toThrow('Required image');
    expect(() => localizeMarkdown('![a](url)', new Map([['url', '../existing.md']]))).toThrow('safe relative');
    expect(() => localizeMarkdown('<img src="https://example.com/a">', new Map())).toThrow('HTML');
    expect(() => localizeMarkdown('fact\uE200cite\uE202turn0search0\uE201', new Map())).toThrow('Citation');
  });
  it('builds a deduplicated image manifest across all messages, including offscreen and tool images', () => {
    const messages = [textMessage('old', '![a](https://example.com/a.png)'),
      { id: 'generated', role: 'assistant', sourceKind: 'tool-image', parts: [{ type: 'image', pointer: 'sediment://file-123' }] } as GraphMessage,
      textMessage('latest', '![a](https://example.com/a.png)')];
    expect(imageManifest(messages)).toEqual([
      { reference: 'https://example.com/a.png', messageIds: ['old', 'latest'] },
      { reference: 'sediment://file-123', messageIds: ['generated'] },
    ]);
  });
  it('renders deterministic bodies with complete local assets and no injected heading from title', () => {
    const input = { title: 'test\n## injected', sourceUrl: 'https://chatgpt.com/c/fixture',
      messages: [textMessage('u', 'Hello'), { id: 'a', role: 'assistant', parts: [{ type: 'image', pointer: 'sediment://file-123' }] } as GraphMessage],
      assets: new Map([['sediment://file-123', 'assets/image.png']]) };
    const body = renderConversation(input);
    expect(body).toBe(renderConversation(input));
    expect(body).toContain('## 用户\n\nHello');
    expect(body).toContain('## ChatGPT\n\n![[assets/image.png]]');
    expect(body).not.toContain('\n## injected');
    expect(() => renderConversation({ ...input, assets: new Map() })).toThrow('Required image');
    expect(() => renderConversation({ ...input, sourceUrl: 'https://evil.test/c/fixture' })).toThrow('Expected');
  });
});
