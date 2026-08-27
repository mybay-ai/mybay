import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import WordExtractor from "word-extractor";
import * as XLSX from "@e965/xlsx";

XLSX.set_fs(fs);

export const OFFICE_ARTIFACT_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEETS = 8;
const MAX_ROWS_PER_SHEET = 250;
const MAX_COLUMNS_PER_SHEET = 50;
const MAX_SLIDES = 200;
const MAX_SLIDE_XML_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 1_500_000;
const MAX_PRESENTATION_TEXT_CHARS = 2_000_000;

export type OfficeArtifactPreview = {
  html: string;
  mode: "document" | "spreadsheet" | "presentation" | "legacy-presentation";
  truncated: boolean;
};

export function escapeOfficePreviewHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function wrapOfficePreview(title: string, body: string, mode: OfficeArtifactPreview["mode"]): string {
  const safeTitle = escapeOfficePreviewHtml(title);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><meta name="referrer" content="no-referrer"><title>${safeTitle}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#111827;font:14px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:1100px;margin:0 auto;padding:24px}.title{margin:0 0 16px;font-size:16px}.page,.slide,.sheet{margin:0 0 18px;padding:24px;border:1px solid #dbe2ea;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.05)}.slide{min-height:300px}.slide h2,.sheet h2{margin:0 0 14px;font-size:14px;color:#475569}.content{white-space:pre-wrap;overflow-wrap:anywhere}.notice{margin:0 0 14px;padding:10px 12px;border-radius:8px;background:#fff7ed;color:#9a3412}table{width:100%;border-collapse:collapse;font-size:12px}th,td{max-width:360px;padding:6px 8px;border:1px solid #dbe2ea;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{position:sticky;top:0;background:#f8fafc;color:#475569}</style></head><body data-office-preview="${mode}"><main class="shell"><h1 class="title">${safeTitle}</h1>${body}</main></body></html>`;
}

function renderWordPreview(filePath: string, title: string): Promise<OfficeArtifactPreview> {
  const extractor = new WordExtractor();
  return extractor.extract(filePath).then((document: any) => {
    const sections = [document.getHeaders?.(), document.getBody?.(), document.getFootnotes?.(), document.getEndnotes?.(), document.getFooters?.()]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .join("\n\n")
      .trim();
    const truncated = sections.length > MAX_DOCUMENT_TEXT_CHARS;
    const visibleText = truncated ? sections.slice(0, MAX_DOCUMENT_TEXT_CHARS) : sections;
    const notice = truncated ? `<p class="notice">The document preview was truncated for local safety.</p>` : "";
    const body = `${notice}<article class="page"><div class="content">${escapeOfficePreviewHtml(visibleText || "(No readable text found)")}</div></article>`;
    return { html: wrapOfficePreview(title, body, "document"), mode: "document", truncated };
  });
}

function renderSpreadsheetPreview(filePath: string, title: string): OfficeArtifactPreview {
  const workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false, cellStyles: false });
  const sheetNames = workbook.SheetNames.slice(0, MAX_SHEETS);
  let truncated = workbook.SheetNames.length > sheetNames.length;
  const body = sheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });
    const visibleRows = rows.slice(0, MAX_ROWS_PER_SHEET);
    if (rows.length > visibleRows.length || visibleRows.some(row => row.length > MAX_COLUMNS_PER_SHEET)) truncated = true;
    const columnCount = Math.min(MAX_COLUMNS_PER_SHEET, visibleRows.reduce((max, row) => Math.max(max, row.length), 0));
    const header = `<tr>${Array.from({ length: columnCount }, (_, index) => `<th>${index + 1}</th>`).join("")}</tr>`;
    const tableRows = visibleRows.map(row => `<tr>${Array.from({ length: columnCount }, (_, index) => `<td>${escapeOfficePreviewHtml(row[index])}</td>`).join("")}</tr>`).join("");
    return `<section class="sheet"><h2>${escapeOfficePreviewHtml(sheetName)}</h2><div style="overflow:auto"><table><thead>${header}</thead><tbody>${tableRows}</tbody></table></div></section>`;
  }).join("");
  const notice = truncated ? `<p class="notice">Preview is limited to ${MAX_SHEETS} sheets, ${MAX_ROWS_PER_SHEET} rows and ${MAX_COLUMNS_PER_SHEET} columns.</p>` : "";
  return { html: wrapOfficePreview(title, notice + body, "spreadsheet"), mode: "spreadsheet", truncated };
}

function slideNumber(entryName: string): number {
  return Number(entryName.match(/slide(\d+)\.xml$/i)?.[1] || Number.MAX_SAFE_INTEGER);
}

function renderPptxPreview(filePath: string, title: string): OfficeArtifactPreview {
  const archive = new AdmZip(filePath);
  const slides = archive.getEntries()
    .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((left, right) => slideNumber(left.entryName) - slideNumber(right.entryName));
  const visibleSlides = slides.slice(0, MAX_SLIDES);
  let truncated = slides.length > visibleSlides.length;
  let extractedCharacters = 0;
  const body = visibleSlides.map((entry, index) => {
    if (extractedCharacters >= MAX_PRESENTATION_TEXT_CHARS) {
      truncated = true;
      return "";
    }
    if (entry.header.size > MAX_SLIDE_XML_BYTES) {
      truncated = true;
      return `<section class="slide"><h2>Slide ${index + 1}</h2><p class="notice">This slide is too large to preview.</p></section>`;
    }
    const xml = entry.getData().toString("utf8");
    const paragraphs = Array.from(xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/gi)).map(paragraph => (
      Array.from(paragraph[1].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi))
        .map(match => decodeXmlText(match[1]))
        .join("")
        .trim()
    )).filter(Boolean);
    const slideText = paragraphs.join("\n") || "(No readable text found)";
    const remainingCharacters = MAX_PRESENTATION_TEXT_CHARS - extractedCharacters;
    const visibleText = slideText.slice(0, remainingCharacters);
    extractedCharacters += visibleText.length;
    if (visibleText.length < slideText.length) truncated = true;
    return `<section class="slide"><h2>Slide ${index + 1}</h2><div class="content">${escapeOfficePreviewHtml(visibleText)}</div></section>`;
  }).join("");
  return { html: wrapOfficePreview(title, body, "presentation"), mode: "presentation", truncated };
}

export function extractLegacyPresentationText(buffer: Buffer): string[] {
  const candidates = [
    ...(buffer.toString("utf16le").match(/[\p{L}\p{N}][\p{L}\p{N}\p{P}\p{Zs}\t]{3,}/gu) || []),
    ...(buffer.toString("latin1").match(/[\x20-\x7E]{4,}/g) || []),
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const candidate of candidates) {
    const line = candidate.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!line || seen.has(line) || /^[\W_]+$/u.test(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= 500) break;
  }
  return lines;
}

function renderLegacyPptPreview(filePath: string, title: string): OfficeArtifactPreview {
  const lines = extractLegacyPresentationText(fs.readFileSync(filePath));
  const notice = `<p class="notice">Legacy .ppt preview extracts readable slide text. Layout, images and animations are not available.</p>`;
  const body = `${notice}<section class="slide"><div class="content">${escapeOfficePreviewHtml(lines.join("\n") || "(No readable text found)")}</div></section>`;
  return { html: wrapOfficePreview(title, body, "legacy-presentation"), mode: "legacy-presentation", truncated: lines.length >= 500 };
}

export async function renderLocalOfficePreview(filePath: string, displayName = path.basename(filePath)): Promise<OfficeArtifactPreview> {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw Object.assign(new Error("OFFICE_PREVIEW_NOT_FILE"), { code: "OFFICE_PREVIEW_NOT_FILE", status: 400 });
  if (stats.size > OFFICE_ARTIFACT_PREVIEW_MAX_BYTES) throw Object.assign(new Error("OFFICE_PREVIEW_TOO_LARGE"), { code: "OFFICE_PREVIEW_TOO_LARGE", status: 413, size: stats.size });
  const extension = path.extname(displayName).toLowerCase();
  if (extension === ".doc" || extension === ".docx") return renderWordPreview(filePath, displayName);
  if (extension === ".xls" || extension === ".xlsx") return renderSpreadsheetPreview(filePath, displayName);
  if (extension === ".pptx") return renderPptxPreview(filePath, displayName);
  if (extension === ".ppt") return renderLegacyPptPreview(filePath, displayName);
  throw Object.assign(new Error("OFFICE_PREVIEW_TYPE_UNSUPPORTED"), { code: "OFFICE_PREVIEW_TYPE_UNSUPPORTED", status: 415 });
}
