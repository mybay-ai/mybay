import { createHeadingSlugger } from "./docsSlug";
import type { DocsFrontmatter, DocsHeading } from "./docsTypes";

export interface ParsedMarkdownDocument {
  frontmatter: DocsFrontmatter;
  markdown: string;
  headings: DocsHeading[];
  plainText: string;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(source: string): { data: Record<string, string | string[]>; body: string } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Markdown document must start with YAML frontmatter");
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error("Markdown frontmatter is not terminated");
  }

  const data: Record<string, string | string[]> = {};
  const lines = normalized.slice(4, end).split("\n");
  let listKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && listKey) {
      const values = Array.isArray(data[listKey]) ? data[listKey] as string[] : [];
      values.push(parseScalar(listMatch[1]));
      data[listKey] = values;
      continue;
    }
    const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!fieldMatch) {
      if (line.trim()) throw new Error(`Unsupported frontmatter line: ${line}`);
      continue;
    }
    const [, key, value] = fieldMatch;
    if (!value.trim()) {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = parseScalar(value);
      listKey = null;
    }
  }

  return { data, body: normalized.slice(end + 5).trim() };
}

export function extractHeadings(markdown: string): DocsHeading[] {
  const slug = createHeadingSlugger();
  const headings: DocsHeading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const text = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    headings.push({ id: slug(text), text, level: match[1].length });
  }
  return headings;
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, block => block.replace(/^```[^\n]*|```$/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*>\s*\[![A-Z]+\]\s*/gim, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  const { data, body } = parseFrontmatter(source);
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  if (!title) throw new Error("Frontmatter field 'title' is required");
  if (!description) throw new Error("Frontmatter field 'description' is required");
  const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : undefined;
  if (updatedAt && !/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error("Frontmatter field 'updatedAt' must use YYYY-MM-DD");
  }
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  return {
    frontmatter: { title, description, updatedAt, keywords },
    markdown: body,
    headings: extractHeadings(body),
    plainText: markdownToPlainText(body),
  };
}
