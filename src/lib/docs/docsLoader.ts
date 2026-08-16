import { parseMarkdownDocument } from "./docsParser";
import { resolveDocsId } from "./docsAliases";
import type { DocsDocument, DocsLocale } from "./docsTypes";

const markdownModules = (import.meta as any).glob("../../../content/docs/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function moduleKey(locale: DocsLocale, id: string): string | undefined {
  const suffix = `/content/docs/${locale}/${id}.md`;
  return Object.keys(markdownModules).find(key => key.replace(/\\/g, "/").endsWith(suffix));
}

export function hasMarkdownDocument(locale: DocsLocale, rawId: string): boolean {
  return Boolean(moduleKey(locale, resolveDocsId(rawId)));
}

export function getMarkdownDocumentSync(locale: DocsLocale, rawId: string): DocsDocument | null {
  const id = resolveDocsId(rawId);
  let selectedLocale = locale;
  let key = moduleKey(locale, id);
  let isFallback = false;
  if (!key && locale === "en") {
    selectedLocale = "zh-CN";
    key = moduleKey("zh-CN", id);
    isFallback = Boolean(key);
  }
  if (!key) return null;
  const parsed = parseMarkdownDocument(markdownModules[key]);
  return {
    id,
    locale: selectedLocale,
    ...parsed.frontmatter,
    markdown: parsed.markdown,
    headings: parsed.headings,
    plainText: parsed.plainText,
    sourcePath: key,
    isFallback,
  };
}

export async function loadMarkdownDocument(locale: DocsLocale, rawId: string): Promise<DocsDocument | null> {
  return getMarkdownDocumentSync(locale, rawId);
}
