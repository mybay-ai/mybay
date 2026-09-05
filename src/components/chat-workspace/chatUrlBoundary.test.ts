import { describe, expect, it } from 'vitest';
import { extractChatUrls } from './chatUrlBoundary';

describe('workspace links', () => {
  it('excludes command quotes and deduplicates links', () => {
    expect(extractChatUrls('extract "https://某网页" and \'https://某网页\'')).toEqual(['https://某网页']);
  });
  it('uses the chat prose boundary and preserves explicit Unicode destinations', () => {
    expect(extractChatUrls('https://example.com查看结果。 https://example.com/中文?q=北京 [链接](https://example.com/path中文?q=值) www.example.org。'))
      .toEqual(['https://example.com', 'https://example.com/中文?q=北京', 'https://example.com/path中文?q=值', 'https://www.example.org']);
  });
  it('trims long formatting suffixes in linear time', () => {
    expect(extractChatUrls(`https://example.com/path${'*'.repeat(20_000)}${'!'.repeat(20_000)}`)).toEqual(['https://example.com/path']);
  });
});
