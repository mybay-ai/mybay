import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../locales/en/dashboard/chatWorkspace.json';
import { attachmentThumbnailUrl, ChatComposerAttachments } from './ChatComposerAttachments';

const file = { id: 'file/a', originalName: 'picture.png', mimeType: 'image/png', size: 1024 };
describe('composer attachment previews', () => {
  it('scopes thumbnail requests to encoded instance, conversation and file identities', () => {
    expect(attachmentThumbnailUrl(file, 'agent/a', 'chat/a')).toBe('/api/instances/agent%2Fa/conversations/chat%2Fa/files/file%2Fa/download?disposition=inline');
  });
  it('does not automatically load missing-context, active-format, non-image or oversized data', () => {
    expect(attachmentThumbnailUrl(file, 'agent')).toBeNull();
    for (const mimeType of ['image/svg+xml', 'text/html', 'application/pdf']) expect(attachmentThumbnailUrl({ ...file, mimeType }, 'a', 'c')).toBeNull();
    expect(attachmentThumbnailUrl({ ...file, size: 9 * 1024 * 1024 }, 'a', 'c')).toBeNull();
  });
  it('limits initial cards and image loads while keeping preview and remove independently accessible', async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: 'en', interpolation: { escapeValue: false }, resources: { en: { dashboard: { chatWorkspace: en } } } });
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatComposerAttachments files={Array.from({ length: 6 }, (_, i) => ({ ...file, id: String(i), originalName: `picture-${i}.png` }))} instanceId="a" conversationId="c" onPreview={vi.fn()} onRemove={vi.fn()} /></I18nextProvider>);
    expect((html.match(/data-composer-attachment=/g) || [])).toHaveLength(3);
    expect((html.match(/<img /g) || [])).toHaveLength(3);
    expect(html).toContain('Show 3 more');
    expect(html).toContain('PNG · 1.0 KB');
    expect(html).toContain('aria-label="Preview attachment: picture-0.png"');
    expect(html).toContain('aria-label="Remove selected file: picture-0.png"');
    expect(html).not.toContain('picture-3.png');
  });
});
