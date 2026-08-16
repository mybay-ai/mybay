import type { DocsSearchRecord } from "./docsTypes";

export interface RankedDocsSearchResult {
  record: DocsSearchRecord;
  score: number;
}

export function scoreDocsSearchRecord(record: DocsSearchRecord, query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const fields = [
    [record.title, 10],
    [record.headings.join(" "), 7],
    [record.keywords.join(" "), 6],
    [record.description, 4],
    [record.content, 1],
  ] as const;

  let score = 0;
  for (const token of tokens) {
    for (const [value, weight] of fields) {
      const haystack = value.toLowerCase();
      if (haystack === token) score += weight * 3;
      else if (haystack.includes(token)) score += weight;
    }
  }
  if (record.title.toLowerCase().startsWith(normalized)) score += 8;
  return score;
}

export function rankDocsSearch(records: DocsSearchRecord[], query: string, limit = 12): RankedDocsSearchResult[] {
  return records
    .map(record => ({ record, score: scoreDocsSearchRecord(record, query) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.record.title.localeCompare(b.record.title))
    .slice(0, limit);
}
