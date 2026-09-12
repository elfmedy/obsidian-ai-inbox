import { describe, expect, it, vi } from 'vitest';
import { downloadChatImage } from '../spikes/assets/chatgpt-image';
import { parseVisibleMessage } from '../spikes/capture/graph';
import { FIXTURE_PNG } from '../spikes/transport/server';
import { ownedArrayBuffer } from '../spikes/assets/binary';

function response(url: string, body: string | Uint8Array, status = 200, mime = 'application/json') {
  const result = new Response(typeof body === 'string' ? body : ownedArrayBuffer(body), { status, headers: { 'Content-Type': mime } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
const api = 'https://chatgpt.com/backend-api/files/download/file-123?post_id=&inline=false';
const alternate = 'https://chatgpt.com/backend-api/files/file-123/download';
const cdn = 'https://files.oaiusercontent.com/synthetic.png';
describe('pinned exporter image adapters', () => {
  it('resolves a pointer and downloads bytes without forwarding bearer credentials to the CDN', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(api, JSON.stringify({ download_url: cdn })))
      .mockResolvedValueOnce(response(cdn, FIXTURE_PNG, 200, 'image/png'));
    const image = await downloadChatImage('sediment://file-123', 'private-token', fetcher);
    expect(image.bytes).toEqual(new Uint8Array(FIXTURE_PNG));
    expect(image.route).toBe('files-download');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer private-token' });
    expect(fetcher.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect(fetcher.mock.calls[1]?.[1]?.credentials).toBe('omit');
    expect(JSON.stringify(image)).not.toContain('private-token');
  });
  it('uses the second upstream route only after 404/405, never after 401/403/429', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(api, '{}', 404))
      .mockResolvedValueOnce(response(alternate, JSON.stringify({ download_url: cdn })))
      .mockResolvedValueOnce(response(cdn, FIXTURE_PNG, 200, 'image/png'));
    expect((await downloadChatImage('file-123', undefined, fetcher)).route).toBe('file-download');
    for (const status of [401, 403, 429]) {
      const rejected = vi.fn<typeof fetch>().mockResolvedValue(response(api, '{}', status));
      await expect(downloadChatImage('file-123', undefined, rejected)).rejects.toThrow();
      expect(rejected).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects an untrusted resolved host, redirects, bad JSON shape and HTML bytes', async () => {
    for (const data of [{ download_url: 'http://127.0.0.1/private' }, {}, { download_url: 'https://chatgpt.com.evil.test/private' }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(api, JSON.stringify(data)));
      await expect(downloadChatImage('file-123', undefined, fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await expect(downloadChatImage(cdn, undefined, vi.fn<typeof fetch>().mockResolvedValue(response('https://evil.test', FIXTURE_PNG))))
      .rejects.toThrow('redirected');
    await expect(downloadChatImage(cdn, undefined, vi.fn<typeof fetch>().mockResolvedValue(response(cdn, '<html>sign in</html>'))))
      .rejects.toThrow('Unsupported image');
    await expect(downloadChatImage(cdn, undefined, vi.fn<typeof fetch>().mockResolvedValue(response(cdn, FIXTURE_PNG, 200, 'image/jpeg'))))
      .rejects.toMatchObject({ code: 'IMAGE_MIME_MISMATCH' });
  });
  it.each(['file:///C:/secret.png', 'sediment://../../secret', 'javascript:alert(1)', 'http://localhost/private'])('never requests invalid reference %s', async value => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(downloadChatImage(value, undefined, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the generated image candidate opt-in until live validation, preserving tool image assets when enabled', () => {
    const tool = { id: 'generated', author: { role: 'tool' }, status: 'finished_successfully',
      content: { content_type: 'execution_output', text: 'internal execution log' },
      metadata: { aggregate_result: { messages: [{ message_type: 'image', image_url: 'sediment://file-123' }] } } };
    expect(() => parseVisibleMessage(tool)).toThrow('Tool image needs an asset adapter');
    expect(parseVisibleMessage(tool, new Set(), true)).toEqual({ id: 'generated', role: 'assistant', sourceKind: 'tool-image',
      parts: [{ type: 'image', pointer: 'sediment://file-123' }] });
    expect(() => parseVisibleMessage({ ...tool, status: 'in_progress' }, new Set(), true)).toThrow('unfinished');
  });
  it('preserves nested image assets and deduplicates metadata attachment aliases', () => {
    const user = { id: 'u', author: { role: 'user' }, content: { content_type: 'multimodal_text',
      parts: ['Hello', { content_type: 'image_asset', image_asset: { asset_pointer: 'file-123' } }] },
      metadata: { attachments: [{ mime_type: 'image/png', id: 'file-123' }] } };
    expect(parseVisibleMessage(user)?.parts).toEqual([{ type: 'text', text: 'Hello' }, { type: 'image', pointer: 'file-123' }]);
  });
});
