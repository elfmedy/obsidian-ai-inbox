import { createHash } from 'node:crypto';
import { ProbeError } from '../shared/errors';

export const hash = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const normalizeBody = (body: string): string => body.replace(/\r\n/g, '\n');

export function splitMarkdown(text: string): { prefix: string; body: string } {
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(text);
  if (!opening) return { prefix: '', body: text };
  const closing = /^---(?:\r?\n|$)/m.exec(text.slice(opening[0].length));
  if (!closing) throw new ProbeError('INVALID_FRONTMATTER', 'Unclosed YAML frontmatter');
  const end = opening[0].length + closing.index + closing[0].length;
  return { prefix: text.slice(0, end), body: text.slice(end) };
}

export function decideSave(input: {
  trustedTarget: boolean;
  localBody: string;
  baselineBodyHash: string;
  previousSourceHash: string;
  sourceHash: string;
  localAssetModified?: boolean;
}): 'created' | 'forked' | 'updated' | 'unchanged' {
  if (!input.trustedTarget) return 'created';
  if (hash(normalizeBody(input.localBody)) !== input.baselineBodyHash || input.localAssetModified) return 'forked';
  return input.sourceHash === input.previousSourceHash ? 'unchanged' : 'updated';
}

export function replacementIfUnchanged(current: string, expectedFullText: string, newBody: string): string {
  if (current !== expectedFullText) throw new ProbeError('REPLAN_REQUIRED', 'File changed during preparation');
  return splitMarkdown(current).prefix + newBody;
}

export function safeTitle(title: string): string {
  const withoutControls = [...title].map(char => char.charCodeAt(0) < 32 ? ' ' : char).join('');
  let result = [...withoutControls.replace(/[<>:"/\\|?*]/g, ' ')].slice(0, 80).join('').replace(/[ .]+$/g, '').trim();
  if (!result) result = 'ChatGPT 对话';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}

export function timestampName(title: string, date: Date, suffix = 1): string {
  const n = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${n(date.getMonth() + 1)}-${n(date.getDate())} ${n(date.getHours())}${n(date.getMinutes())}${n(date.getSeconds())}`;
  return `${safeTitle(title)} ${stamp}${suffix > 1 ? `-${suffix}` : ''}.md`;
}
