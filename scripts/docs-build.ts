import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdownDocument } from "../src/lib/docs/docsParser";
import { legacyDocsAliases } from "../src/lib/docs/docsAliases";
import { documentHref } from "../src/lib/docs/docsSlug";
import type { DocsLocale, DocsSearchRecord } from "../src/lib/docs/docsTypes";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(projectRoot, "content", "docs");
const publicRoot = path.join(projectRoot, "public", "docs");
const locales: DocsLocale[] = ["zh-CN", "en"];
const writeOutputs = process.argv.includes("--write");

type MetaItem = { id: string; title: string; legacyId?: string };
type MetaGroup = { id: string; title: string; items: MetaItem[] };
type MetaFile = { groups: MetaGroup[] };
type ParsedFile = ReturnType<typeof parseMarkdownDocument> & { id: string; locale: DocsLocale; file: string };

const errors: string[] = [];
const warnings: string[] = [];
const forbiddenEditionPatterns = [
  { pattern: /平台模型|积分扣费|订阅套餐|商业版|邮箱验证|多租户/i, label: "commercial-edition Chinese copy" },
  { pattern: /platform model|model credits|subscription plan|commercial edition|email verification|multi-tenant/i, label: "commercial-edition English copy" },
];

function walkMarkdown(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkMarkdown(fullPath) : entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

function readMeta(locale: DocsLocale): MetaFile {
  const file = path.join(contentRoot, locale, "_meta.json");
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value.groups)) throw new Error("groups must be an array");
    return value;
  } catch (error) {
    errors.push(`${locale}/_meta.json: ${error instanceof Error ? error.message : String(error)}`);
    return { groups: [] };
  }
}

function parseLocale(locale: DocsLocale): ParsedFile[] {
  const root = path.join(contentRoot, locale);
  const seen = new Set<string>();
  return walkMarkdown(root).flatMap(file => {
    const id = path.relative(root, file).replace(/\\/g, "/").replace(/\.md$/, "");
    if (seen.has(id)) errors.push(`${locale}: duplicate document ID '${id}'`);
    seen.add(id);
    try {
      const source = fs.readFileSync(file, "utf8");
      for (const rule of forbiddenEditionPatterns) {
        if (rule.pattern.test(source)) errors.push(`${locale}/${id}: ${rule.label} is not allowed in open-source documentation`);
      }
      if (/<\s*(script|iframe)\b/i.test(source) || /\b(onerror|onclick)\s*=|javascript\s*:/i.test(source)) {
        errors.push(`${locale}/${id}: unsafe HTML or JavaScript is not allowed`);
      }
      return [{ id, locale, file, ...parseMarkdownDocument(source) }];
    } catch (error) {
      errors.push(`${locale}/${id}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
}

function validateLinksAndImages(document: ParsedFile, allIds: Set<string>) {
  const markdown = document.markdown;
  for (const match of markdown.matchAll(/\[[^\]]*\]\((\/docs\/[^)]+)\)/g)) {
    const target = decodeURIComponent(match[1].replace(/^\/docs\//, "").split(/[?#]/)[0].replace(/\/$/, ""));
    const resolved = legacyDocsAliases[target] || target;
    if (target && !allIds.has(resolved)) errors.push(`${document.locale}/${document.id}: broken internal link '${match[1]}'`);
  }
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((\/docs\/images\/[^)]+)\)/g)) {
    const relative = decodeURIComponent(match[1].replace(/^\//, ""));
    if (!fs.existsSync(path.join(projectRoot, "public", relative))) errors.push(`${document.locale}/${document.id}: missing image '${match[1]}'`);
  }
}

const documentsByLocale = new Map<DocsLocale, ParsedFile[]>();
const metas = new Map<DocsLocale, MetaFile>();
for (const locale of locales) {
  documentsByLocale.set(locale, parseLocale(locale));
  metas.set(locale, readMeta(locale));
}

for (const locale of locales) {
  const documents = documentsByLocale.get(locale) || [];
  const ids = new Set(documents.map(document => document.id));
  const navItems = (metas.get(locale)?.groups || []).flatMap(group => group.items);
  const navIds = new Set<string>();
  for (const item of navItems) {
    if (navIds.has(item.id)) errors.push(`${locale}/_meta.json: duplicate navigation entry '${item.id}'`);
    navIds.add(item.id);
    if (!ids.has(item.id)) errors.push(`${locale}/_meta.json: missing document '${item.id}'`);
  }
  for (const id of ids) if (!navIds.has(id)) errors.push(`${locale}: orphan document '${id}'`);
  for (const document of documents) validateLinksAndImages(document, ids);
}

const zhIds = new Set((documentsByLocale.get("zh-CN") || []).map(document => document.id));
const enIds = new Set((documentsByLocale.get("en") || []).map(document => document.id));
for (const id of zhIds) if (!enIds.has(id)) warnings.push(`Missing English document: ${id}`);
for (const id of enIds) if (!zhIds.has(id)) warnings.push(`Missing Chinese document: ${id}`);
const navigationShape = (meta: MetaFile) => meta.groups.map(group => ({ id: group.id, items: group.items.map(item => item.id) }));
if (JSON.stringify(navigationShape(metas.get("zh-CN") || { groups: [] })) !== JSON.stringify(navigationShape(metas.get("en") || { groups: [] }))) {
  errors.push("zh-CN/en navigation group and document ID structures must match");
}

if (writeOutputs && errors.length === 0) {
  fs.mkdirSync(publicRoot, { recursive: true });
  const manifest: any = { generatedAt: new Date().toISOString(), documents: [], navigation: {} };
  for (const locale of locales) {
    const documents = documentsByLocale.get(locale) || [];
    const search: DocsSearchRecord[] = documents.map(document => ({
      id: document.id,
      locale,
      title: document.frontmatter.title,
      description: document.frontmatter.description,
      keywords: document.frontmatter.keywords,
      headings: document.headings.map(heading => heading.text),
      content: document.plainText,
      href: documentHref(document.id),
    }));
    manifest.documents.push(...documents.map(document => ({
      id: document.id,
      locale,
      title: document.frontmatter.title,
      description: document.frontmatter.description,
      updatedAt: document.frontmatter.updatedAt,
      keywords: document.frontmatter.keywords,
      headings: document.headings,
      href: documentHref(document.id),
      sourcePath: path.relative(projectRoot, document.file).replace(/\\/g, "/"),
    })));
    manifest.navigation[locale] = metas.get(locale)?.groups || [];
    fs.writeFileSync(path.join(publicRoot, `docs-search-index.${locale}.json`), JSON.stringify(search, null, 2), "utf8");
  }
  fs.writeFileSync(path.join(publicRoot, "docs-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

for (const warning of warnings) console.warn(`[docs:warn] ${warning}`);
for (const error of errors) console.error(`[docs:error] ${error}`);
console.log(`[docs] ${locales.map(locale => `${locale}=${documentsByLocale.get(locale)?.length || 0}`).join(" ")} warnings=${warnings.length} errors=${errors.length}`);
if (errors.length > 0) process.exitCode = 1;
