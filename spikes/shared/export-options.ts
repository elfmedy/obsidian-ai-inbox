import { z } from 'zod';

export const ExportOptions = z.strictObject({ includeThinking: z.boolean(), includeTitle: z.boolean(), language: z.enum(['zh', 'en']) });
export type ExportOptionsData = z.infer<typeof ExportOptions>;
export const DEFAULT_EXPORT_OPTIONS: ExportOptionsData = { includeThinking: false, includeTitle: false, language: 'zh' };
export const ContentSettings = z.strictObject({ includeThinking: z.boolean().default(false), includeTitle: z.boolean().default(false),
  language: z.enum(['auto', 'zh', 'en']).default('auto') });
export type ContentSettingsData = z.infer<typeof ContentSettings>;
export function resolveLanguage(preference: ContentSettingsData['language'], obsidianLanguage: string): 'zh' | 'en' {
  return preference === 'auto' ? (obsidianLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en') : preference;
}
