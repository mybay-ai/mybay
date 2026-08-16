import { documentHref } from "./docsSlug";
import { resolveDocsId } from "./docsAliases";
import type { DocsLocale, DocsNavigationEntry, DocsNavigationGroup } from "./docsTypes";

interface MetaItem { id: string; title: string; legacyId?: string }
interface MetaGroup { id: string; title: string; items: MetaItem[] }
interface MetaFile { title: string; groups: MetaGroup[] }

const metaModules = (import.meta as any).glob("../../../content/docs/*/_meta.json", {
  eager: true,
  import: "default",
}) as Record<string, MetaFile>;

function metaFor(locale: DocsLocale): MetaFile {
  const suffix = `/content/docs/${locale}/_meta.json`;
  const key = Object.keys(metaModules).find(candidate => candidate.replace(/\\/g, "/").endsWith(suffix));
  return key ? metaModules[key] : { title: "", groups: [] };
}

export function getDocsRootTitle(locale: DocsLocale): string {
  return metaFor(locale).title;
}

export function getDocsNavigation(locale: DocsLocale): DocsNavigationGroup[] {
  return metaFor(locale).groups.map(group => ({
    id: group.id,
    title: group.title,
    items: group.items.map(item => ({
      id: item.id,
      title: item.title,
      href: documentHref(item.id),
      legacyIds: item.legacyId ? [item.legacyId] : undefined,
    })),
  }));
}

export function getFlatDocsNavigation(locale: DocsLocale): DocsNavigationEntry[] {
  return getDocsNavigation(locale).flatMap(group => group.items);
}

export function findDocsNavigationEntry(locale: DocsLocale, rawId: string): DocsNavigationEntry | undefined {
  const id = resolveDocsId(rawId);
  return getFlatDocsNavigation(locale).find(entry => entry.id === id || entry.legacyIds?.includes(rawId));
}

export function getDocsPagination(locale: DocsLocale, rawId: string) {
  const entries = getFlatDocsNavigation(locale);
  const id = resolveDocsId(rawId);
  const index = entries.findIndex(entry => entry.id === id || entry.legacyIds?.includes(rawId));
  return {
    previous: index > 0 ? entries[index - 1] : undefined,
    next: index >= 0 && index < entries.length - 1 ? entries[index + 1] : undefined,
  };
}

export function getDocsBreadcrumbs(locale: DocsLocale, rawId: string): string[] {
  const id = resolveDocsId(rawId);
  for (const group of getDocsNavigation(locale)) {
    const item = group.items.find(entry => entry.id === id || entry.legacyIds?.includes(rawId));
    if (item) return [getDocsRootTitle(locale), group.title, item.title];
  }
  return [getDocsRootTitle(locale)];
}
