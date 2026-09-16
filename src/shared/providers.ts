export type Provider = 'chatgpt' | 'gemini' | 'claude';
export const PROVIDER_NAMES: Record<Provider, string> = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' };
export interface ConversationLocation { provider: Provider; id: string; url: string; }
export function conversationLocation(value: string | undefined): ConversationLocation | null {
  if (!value) return null;
  let url: URL; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  const provider: Provider | undefined = url.hostname === 'chatgpt.com' ? 'chatgpt' : url.hostname === 'gemini.google.com' ? 'gemini' : url.hostname === 'claude.ai' ? 'claude' : undefined;
  if (!provider) return null;
  const pattern = provider === 'chatgpt' ? /^\/c\/([A-Za-z0-9-]{1,128})\/?$/ : provider === 'gemini'
    ? /^\/(?:u\/\d+\/)?app\/([A-Za-z0-9_-]{1,128})\/?$/ : /^\/chat\/([A-Za-z0-9-]{1,128})\/?$/;
  const match = pattern.exec(url.pathname); if (!match) return null;
  const id = match[1]!;
  return { provider, id, url: `https://${url.hostname}/${provider === 'chatgpt' ? 'c' : provider === 'gemini' ? 'app' : 'chat'}/${id}` };
}
/** Keep pre-multisite ChatGPT keys so installed vaults continue updating their notes. */
export function conversationKey(provider: Provider, id: string): string { return provider === 'chatgpt' ? id : `${provider}:${id}`; }
