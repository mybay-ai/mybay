import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownChatContent } from './ChatMessageContent';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const render = (content: string) => renderToStaticMarkup(<MarkdownChatContent content={content} conversationFiles={[]} onOpenInstanceFilePath={() => {}} />);

describe('chat Markdown content boundaries', () => {
  it('separates Chinese prose and punctuation from bare URLs', () => {
    const html = render('打开 https://example.com查看结果。以及 https://example.com/path，完成。');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('</a>查看结果。');
    expect(html).toContain('</a>，完成。');
  });
  it('keeps explicit Markdown URLs and Unicode components unchanged', () => {
    const explicit = 'https://example.com/path中文?q=值';
    const html = render(`[完整链接](${explicit})\n\nhttps://example.com/中文?q=北京\n\nhttps://例子.测试/说明`);
    expect(html).toContain('href="'+encodeURI(explicit)+'"');
    expect(html).toContain('href="https://example.com/中文?q=北京"');
    expect(html).toContain('https://例子.测试/说明');
  });
  it('keeps a single line fenced command literal even when it contains a file path', () => {
    const html = render('```\ncat /opt/data/outputs/report.md\n```');
    expect(html).toContain('<code class="">cat /opt/data/outputs/report.md</code>');
    expect(html).not.toContain('aria-label="chatWorkspace.openFile');
  });
  it('uses filenames but retains the original target for same-name files', () => {
    const html = render('查看 /opt/data/outputs/report.md 和 /opt/data/reports/report.md');
    expect(html).toContain('title="/opt/data/outputs/report.md"');
    expect(html).toContain('title="/opt/data/reports/report.md"');
    expect(html.match(/>report.md<\/span>/g)).toHaveLength(2);
  });
  it('escapes untrusted content and preserves code indentation', () => {
    const html = render('```js\nif (ok) {\n  run();\n}\n```\n\n<script>alert(1)</script>');
    expect(html).toContain('  run();\n}');
    expect(html).not.toContain('<script>');
  });
});
