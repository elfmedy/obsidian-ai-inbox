import { describe, expect, it } from 'vitest';
import { ContentSettings, resolveLanguage } from '../src/shared/export-options';
import { translate } from '../src/obsidian/i18n';

describe('vault content preferences and interface language', () => {
  it('migrates missing settings to both switches off and follows Obsidian', () => {
    expect(ContentSettings.parse({})).toEqual({ includeThinking: false, includeTitle: false, language: 'auto' });
    expect(resolveLanguage('auto', 'zh-TW')).toBe('zh');
    expect(resolveLanguage('auto', 'en')).toBe('en');
    expect(resolveLanguage('auto', 'de')).toBe('en');
    expect(resolveLanguage('zh', 'en')).toBe('zh');
    expect(resolveLanguage('en', 'zh')).toBe('en');
  });
  it('has translated UI messages including pairing and failure paths', () => {
    for (const key of ['pairTitle', 'allow', 'settingsFailed', 'failed', 'resetFailed', 'thinking', 'title'] as const) {
      expect(translate('en', key)).not.toMatch(/[\u4e00-\u9fff]/);
      expect(translate('zh', key)).toMatch(/[\u4e00-\u9fff]/);
    }
  });
});
