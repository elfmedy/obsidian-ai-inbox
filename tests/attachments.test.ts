import { describe, it, expect } from 'vitest';
import { parseVisibleMessage } from '../spikes/capture/graph';
import { localImage } from '../spikes/render/markdown';
describe('attachment fidelity', () => {
  it('encodes attachment folders containing hash, percent and square brackets', () => {
    expect(localImage('Attachments #1/[images] 50%/image.png')).toBe('![](</Attachments%20%231/%5Bimages%5D%2050%25/image.png>)');
  });
  it('accepts upstream flat file_name and nested file envelopes', () => {
    const message = parseVisibleMessage({ id: 'one', author: { role: 'user' }, content: { content_type: 'text', parts: ['Read'] },
      metadata: { attachments: [{ file_name: 'First.pdf', file_id: 'file-first' }, { file: { filename: 'Second.pdf', id: 'file-second' } }, { id: 'file-unnamed' }] } });
    const text = JSON.stringify(message?.parts);
    expect(text).toContain('First'); expect(text).toContain('Second'); expect(text).toContain('名称未提供'); expect(text).toContain('file-unnamed');
  });
  it('recognizes nested MIME images and deduplicates sediment metadata aliases', () => {
    const message = parseVisibleMessage({ id: 'one', author: { role: 'user' }, content: { content_type: 'multimodal_text',
      parts: ['Image', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-image' }] },
      metadata: { attachments: [{ file: { content_type: 'image/png', id: 'file-image' } }, { file_id: 'file-image' }] } });
    expect(message?.parts.filter(part => part.type === 'image')).toHaveLength(1);
    expect(JSON.stringify(message)).not.toContain('附件（未下载）');
  });
  it('keeps rejecting attachments without a usable identity', () => {
    expect(() => parseVisibleMessage({ id: 'one', author: { role: 'user' }, content: { content_type: 'text', parts: ['Read'] },
      metadata: { attachments: [{ file: { unexpected: 'private' } }] } })).toThrow();
  });
  it('preserves a non-image attachment name and stable file reference without downloading it', () => {
    const message = parseVisibleMessage({ id: 'one', author: { role: 'user' }, content: { content_type: 'text', parts: ['Please read'] },
      metadata: { attachments: [{ mime_type: 'application/pdf', name: 'Research.pdf', id: 'file-pdf' }] } });
    expect(message?.parts).toContainEqual({ type: 'text', text: '附件（未下载）：Research\\.pdf；引用：`file-pdf`' });
  });
  it('retains image alt text in a stable Vault-root Markdown image', () => {
    const message = parseVisibleMessage({ id: 'one', author: { role: 'user' }, content: { content_type: 'multimodal_text',
      parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-image', alt: 'Diagram [A]' }] } });
    expect(message?.parts[0]).toEqual({ type: 'image', pointer: 'file-image', alt: 'Diagram [A]' });
    expect(localImage('AI Inbox/_assets/image.png', 'Diagram [A]')).toBe('![Diagram \\[A\\]](</AI%20Inbox/_assets/image.png>)');
  });
});
