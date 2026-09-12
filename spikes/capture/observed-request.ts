import { readBounded } from '../assets/inspect';
import { extractJsonDocuments, findConversationGraphs } from './hydration';
import { isRecord, ProbeError } from '../shared/errors';
import { summarizeResponseShape } from './response-shape';
import { inspectMessageList, messageListCoverage } from './message-list';
import { collectPaginatedMessages } from './paginated-messages';
import { downloadChatImage } from '../assets/chatgpt-image';

interface Resource { name: string; initiatorType: string; }
export interface RequestDiagnostics {
  resourceEntries: number; conversationRequests: number; sessionRequestObserved: boolean;
  attempted: boolean; httpStatus: number | null; sessionHttpStatus: number | null;
  authSource: 'none' | 'page-session' | 'observed-session'; graphCandidates: number;
  error: string | null;
  requestedTurnLimit: number | null;
  responseShape: ReturnType<typeof summarizeResponseShape> | null;
  messageArray: ReturnType<typeof inspectMessageList>['diagnostics'] | null;
  pagination: { additionalRequests: number; pages: number; completed: boolean; headRechecked: boolean } | null;
}

/** Recognition is not permission to invent an endpoint: every returned URL
 * must also have appeared in this page's actual fetch/XHR resource timings. */
export function discoverRequests(resources: Resource[], pageUrl: string) {
  const page = new URL(pageUrl);
  const id = /^\/c\/([a-zA-Z0-9-]+)\/?$/.exec(page.pathname)?.[1];
  if (page.origin !== 'https://chatgpt.com' || !id) throw new ProbeError('UNSUPPORTED_PAGE', 'Expected ordinary chat');
  const conversations = new Set<string>();
  const sessions = new Set<string>();
  for (const resource of resources) {
    if (!['fetch', 'xmlhttprequest'].includes(resource.initiatorType)) continue;
    let url: URL;
    try { url = new URL(resource.name); } catch { continue; }
    if (url.origin !== page.origin || url.username || url.password || url.hash) continue;
    // Observed in the user's Network capture: plural route with these two
    // parameters. Replay the observed URL unchanged; do not raise/remove limits.
    if (url.pathname === `/backend-api/conversations/${id}`) {
      const keys = [...url.searchParams.keys()];
      const known = keys.every(key => ['include_has_versions', 'num_turns'].includes(key));
      const unique = keys.length === new Set(keys).size;
      const versions = url.searchParams.get('include_has_versions');
      const turns = url.searchParams.get('num_turns');
      if (known && unique && (versions === null || ['true', 'false'].includes(versions)) &&
          (turns === null || /^[1-9]\d{0,4}$/.test(turns))) conversations.add(url.href);
    } else if (!url.search) {
      if (url.pathname === `/backend-api/conversation/${id}` || url.pathname === `/backend-api/f/conversation/${id}`) conversations.add(url.href);
      if (url.pathname === '/api/auth/session') sessions.add(url.href);
    }
  }
  return { id, conversations: [...conversations], sessions: [...sessions] };
}

// A session credential is used only in memory for the observed current-chat
// URL. Never include this value or source JSON in diagnostics or storage.
function sessionToken(documents: unknown[]): string | undefined {
  const seen = new Set<object>();
  const queue = [...documents];
  for (let position = 0; position < queue.length; position++) {
    if (position > 200000) return undefined;
    const value = queue[position];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (isRecord(value) && isRecord(value.user) && typeof value.expires === 'string' &&
        typeof value.accessToken === 'string' && value.accessToken.length > 0 &&
        value.accessToken.length < 16384 && !/[\r\n]/.test(value.accessToken)) return value.accessToken;
    const children: unknown[] = Object.values(value);
    for (const child of children) queue.push(child);
  }
  return undefined;
}

async function requestJson(url: string, fetcher: typeof fetch, token?: string) {
  const response = await fetcher(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000) });
  if (response.url !== url || response.redirected) throw new ProbeError('API_IDENTITY_CHANGED', 'Unexpected response URL');
  if (!response.ok) { await response.body?.cancel(); return { status: response.status, data: null }; }
  if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw new ProbeError('API_TYPE_INVALID', 'Expected JSON response');
  }
  const bytes = await readBounded(response, 20 * 1024 * 1024);
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return { status: response.status, data };
}

export async function probeObservedRequest(input: { pageUrl: string; resources: Resource[]; scripts: string[]; enableToolImages?: boolean; includeThinking?: boolean }, fetcher: typeof fetch = fetch) {
  const requests = discoverRequests(input.resources, input.pageUrl);
  const diagnostics: RequestDiagnostics = {
    resourceEntries: input.resources.length, conversationRequests: requests.conversations.length,
    sessionRequestObserved: requests.sessions.length > 0, attempted: false, httpStatus: null,
    sessionHttpStatus: null, authSource: 'none', graphCandidates: 0, error: null,
    requestedTurnLimit: null, responseShape: null, messageArray: null, pagination: null,
  };
  let graphs: Record<string, unknown>[] = [];
  let messageList: ReturnType<typeof inspectMessageList> | null = null;
  let sourceTitle = '';
  let downloadImage: ((reference: string) => ReturnType<typeof downloadChatImage>) | undefined;
  if (requests.conversations.length !== 1) {
    diagnostics.error = requests.conversations.length === 0 ? 'CURRENT_CHAT_REQUEST_NOT_OBSERVED' : 'AMBIGUOUS_CHAT_REQUESTS';
    return { graphs, diagnostics, messageList, sourceTitle, downloadImage };
  }
  try {
    const limit = new URL(requests.conversations[0]!).searchParams.get('num_turns');
    diagnostics.requestedTurnLimit = limit === null ? null : Number(limit);
    const documents = extractJsonDocuments(input.scripts);
    let token = sessionToken(documents);
    if (token) diagnostics.authSource = 'page-session';
    diagnostics.attempted = true;
    let response = await requestJson(requests.conversations[0]!, fetcher, token);
    diagnostics.httpStatus = response.status;
    if (response.status === 401 && !token && requests.sessions.length === 1) {
      const session = await requestJson(requests.sessions[0]!, fetcher);
      diagnostics.sessionHttpStatus = session.status;
      token = sessionToken([session.data]);
      if (token) {
        diagnostics.authSource = 'observed-session';
        response = await requestJson(requests.conversations[0]!, fetcher, token);
        diagnostics.httpStatus = response.status;
      }
    }
    if (response.status !== 200) diagnostics.error = 'CURRENT_CHAT_API_FAILED';
    else {
      sourceTitle = isRecord(response.data) && typeof response.data.title === 'string' ? response.data.title : '';
      downloadImage = reference => downloadChatImage(reference, token, fetcher);
      diagnostics.responseShape = summarizeResponseShape(response.data);
      if (isRecord(response.data) && isRecord(response.data.page_info) && response.data.page_info.has_previous_page === true &&
          new URL(requests.conversations[0]!).pathname === `/backend-api/conversations/${requests.id}`) {
        const pagination = { additionalRequests: 0, pages: 1, completed: false, headRechecked: false };
        diagnostics.pagination = pagination;
        const collected = await collectPaginatedMessages(response.data, requests.id, async before => {
          // Only derive a preceding page of this observed current-chat route.
          // The before contract is documented by the pinned upstream exporter.
          const url = new URL(requests.conversations[0]!);
          if (before !== null) url.searchParams.set('before', before);
          pagination.additionalRequests++;
          const next = await requestJson(url.href, fetcher, token);
          if (next.status !== 200) throw new ProbeError('PAGINATION_REQUEST_FAILED', 'An additional page request failed');
          return next.data;
        });
        pagination.pages = collected.pages;
        pagination.completed = true;
        pagination.headRechecked = collected.headRechecked;
        response = { ...response, data: collected.data };
      }
      if (isRecord(response.data) && Array.isArray(response.data.messages)) {
        messageList = inspectMessageList(response.data, requests.id, messageListCoverage(response.data), input.enableToolImages, input.includeThinking);
        diagnostics.messageArray = messageList.diagnostics;
      }
      graphs = findConversationGraphs([response.data], requests.id);
      diagnostics.graphCandidates = graphs.length;
      if (diagnostics.responseShape.explicitlyPartial && !diagnostics.pagination?.completed) {
        graphs = [];
        diagnostics.error = 'CURRENT_CHAT_RESPONSE_PARTIAL';
      } else if (graphs.length === 0 && !messageList?.diagnostics.validated) {
        diagnostics.error = messageList ? 'CURRENT_CHAT_MESSAGE_ARRAY_UNVERIFIED' : 'CURRENT_CHAT_API_NO_GRAPH';
      }
    }
  } catch (error) {
    diagnostics.error = error instanceof ProbeError ? error.code : 'CURRENT_CHAT_API_REQUEST_FAILED';
  }
  return { graphs, diagnostics, messageList, sourceTitle, downloadImage };
}
