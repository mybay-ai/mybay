export type DocsLocale = "zh-CN" | "en";

export interface DocsFrontmatter {
  title: string;
  description: string;
  updatedAt?: string;
  keywords: string[];
}

export interface DocsHeading {
  id: string;
  text: string;
  level: number;
}

export interface DocsNavigationEntry {
  id: string;
  title: string;
  href: string;
  legacyIds?: string[];
}

export interface DocsNavigationGroup {
  id: string;
  title: string;
  items: DocsNavigationEntry[];
}

export interface DocsDocument {
  id: string;
  locale: DocsLocale;
  title: string;
  description: string;
  updatedAt?: string;
  keywords: string[];
  markdown: string;
  headings: DocsHeading[];
  plainText: string;
  sourcePath: string;
  isFallback: boolean;
  previous?: DocsNavigationEntry;
  next?: DocsNavigationEntry;
}

export interface DocsSearchRecord {
  id: string;
  locale: DocsLocale;
  title: string;
  description: string;
  keywords: string[];
  headings: string[];
  content: string;
  href: string;
}
