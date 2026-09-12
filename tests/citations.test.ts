import { describe, it, expect } from 'vitest';
import { expandCitations, readReferences } from '../spikes/render/citations';
import { localizeMarkdown } from '../spikes/render/markdown';
describe('upstream citation conversion', () => {
  const marker = '\uE200cite\uE202turn0search0\uE201';
  const refs = readReferences({ content_references: [{ type: 'webpage', matched_text: marker, items: [{ title: 'Paper', url: 'https://example.org/paper' }] }] });
  it('converts known citations to links and preserves code and typography', () => {
    const result = expandCitations(`— Claim ${marker}  \n\n\`${marker}\`\n\n$${marker}$`, refs);
    expect(result).toContain('— Claim ([Paper](<https://example.org/paper>))  \n');
    expect(result).toContain(`\`${marker}\``); expect(result).toContain(`$${marker}$`);
    expect(() => localizeMarkdown(result, new Map())).not.toThrow();
  });
  it('does not silently drop unrecognized citations', () => {
    const result = expandCitations(marker, []);
    expect(result).toContain('引用未解析'); expect(result).toContain('turn0search0');
    expect(result).toContain('\\uE200cite\\uE202turn0search0\\uE201');
    expect(() => localizeMarkdown(result, new Map())).not.toThrow();
  });
  it('normalizes upstream format markers even without metadata while preserving typography', () => {
    expect(expandCitations('— A\u00a0\uE203highlight\uE204  \n', [])).toBe('— A\u00a0highlight  \n');
    const normalized = readReferences({ content_references: [{ type: 'grouped_webpages', matched_text: `\uE203${marker}\uE204`,
      items: [{ title: 'Paper', url: 'https://example.org/paper' }] }] });
    expect(expandCitations(marker, normalized)).toContain('[Paper](<https://example.org/paper>)');
  });
  it('keeps markers in code and math untouched with no reference metadata', () => {
    const input = `\`${marker}\`\n\n\`\`\`text\n${marker}\n\`\`\`\n\n$${marker}$`;
    expect(expandCitations(input)).toBe(input);
  });
  it('preserves unknown rich markers as inert text without turning payload into images or HTML', () => {
    const input = '\uE200unknown\uE202`![x](https://example.org/private.png)<b>data</b>\uE201';
    const output = expandCitations(input);
    expect(output).toContain('ChatGPT 标记未解析'); expect(output).toContain('private.png');
    expect(() => localizeMarkdown(output, new Map())).not.toThrow();
    expect(expandCitations(output)).toBe(output);
  });
  it('uses upstream grouped sources, safe URL and alt fallbacks and source footnotes', () => {
    const references = readReferences({ content_references: [
      { type: 'grouped_webpages', matched_text: marker, items: [{ title: 'Paper', url: 'https://example.org/paper',
        supporting_websites: [{ title: 'Support', url: 'https://example.org/support' }] }] },
      { type: 'webpage', matched_text: 'SAFE', safe_urls: ['https://example.org/safe'] },
      { type: 'entity', matched_text: 'ENTITY', alt: 'Entity name' },
      { type: 'sources_footnote', sources: [{ title: 'Sources', url: 'https://example.org/source-list' }] },
    ] });
    const output = expandCitations(`${marker} SAFE ENTITY`, references);
    for (const text of ['paper', 'support', 'safe', 'Entity name', 'source-list']) expect(output).toContain(text);
    expect(output).not.toContain('未解析');
  });
  it('rejects unsafe source URLs and oversized lists', () => {
    expect(() => readReferences({ content_references: [{ type: 'webpage', url: 'javascript:alert(1)' }] })).toThrow();
    expect(() => readReferences({ content_references: [{ type: 'webpage', supporting_websites: Array(101).fill({}) }] })).toThrow();
  });
});
