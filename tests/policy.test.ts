import { describe, expect, it } from 'vitest';
import { decideSave, hash, normalizeBody, replacementIfUnchanged, safeTitle, splitMarkdown, timestampName } from '../src/persistence/policy';

const base = { trustedTarget: true, localBody: 'body\n', baselineBodyHash: hash('body\n'), previousSourceHash: 'old', sourceHash: 'old' };
describe('save rules', () => {
  it('preserves empty frontmatter and does not swallow a later horizontal rule', () => {
    const original = '---\n---\nbody\n---\nend';
    expect(splitMarkdown(original)).toEqual({ prefix: '---\n---\n', body: 'body\n---\nend' });
    expect(replacementIfUnchanged(original, original, 'new')).toBe('---\n---\nnew');
  });
  it.each([
    [{ ...base, trustedTarget: false }, 'created'], [base, 'unchanged'],
    [{ ...base, sourceHash: 'new' }, 'updated'],
    [{ ...base, localBody: 'edited\n' }, 'forked'],
    [{ ...base, localBody: 'edited\n', sourceHash: 'new' }, 'forked'],
    [{ ...base, localAssetModified: true }, 'forked'],
  ] as const)('selects expected action for %j', (input, expected) => expect(decideSave(input)).toBe(expected));
  it('preserves YAML comments, ordering and CRLF bytes', () => {
    const original = '---\r\n# 用户注释\r\ntags: [a]\r\ncustom: 3\r\n---\r\n旧内容\r\n';
    expect(replacementIfUnchanged(original, original, '新内容\n')).toBe('---\r\n# 用户注释\r\ntags: [a]\r\ncustom: 3\r\n---\r\n新内容\n');
  });
  it('rejects a change made during preparation, including properties only', () => {
    expect(() => replacementIfUnchanged('user edit', 'before', 'new')).toThrow('File changed');
  });
  it('does not mistake a horizontal rule later in the document for YAML', () => {
    expect(splitMarkdown('Text\n---\nend')).toEqual({ prefix: '', body: 'Text\n---\nend' });
  });
  it('rejects unclosed frontmatter and preserves body whitespace', () => {
    expect(() => splitMarkdown('---\ntags: []\nbody')).toThrow();
    expect(normalizeBody('a  \r\n\r\n')).toBe('a  \n\n');
    expect(decideSave({ ...base, localBody: 'body \n' })).toBe('forked');
  });
  it('treats only CRLF/LF differences as unchanged', () => expect(decideSave({ ...base, localBody: 'body\r\n' })).toBe('unchanged'));
  it('makes Windows-safe names without changing the configured directory', () => {
    expect(safeTitle('CON')).toBe('_CON');
    expect(safeTitle('../a\\b:*?')).not.toMatch(/[\\/:*?]/);
    expect(safeTitle('   ')).toBe('ChatGPT 对话');
    expect([...safeTitle('图'.repeat(100))]).toHaveLength(80);
    expect(timestampName('讨论', new Date(2026, 8, 12, 9, 8, 7), 2)).toBe('讨论 2026-09-12 090807-2.md');
  });
});
