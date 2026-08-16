import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { detectSafeImageType, isDeclaredImageTypeCompatible } from "./imageUploadSecurity";

export type SafeUploadResult =
  | { ok: true; extension: string; mime: string }
  | { ok: false; error: string };

const MIME_BY_EXTENSION: Record<string, string[]> = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  ".txt": ["text/plain", "application/octet-stream"],
  ".md": ["text/plain", "text/markdown", "application/octet-stream"],
  ".csv": ["text/plain", "text/csv", "application/vnd.ms-excel", "application/octet-stream"],
  ".json": ["application/json", "text/json", "text/plain", "application/octet-stream"],
  ".log": ["text/plain", "application/octet-stream"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json", ".log"]);

export function hasZipMagic(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (
    (buffer[2] === 0x03 && buffer[3] === 0x04) ||
    (buffer[2] === 0x05 && buffer[3] === 0x06) ||
    (buffer[2] === 0x07 && buffer[3] === 0x08)
  );
}

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function isExpectedOfficePackage(buffer: Buffer, extension: string): boolean {
  if (!hasZipMagic(buffer)) return false;
  try {
    const names = new AdmZip(buffer).getEntries().map((entry) => entry.entryName.replace(/\\/g, "/").toLowerCase());
    if (!names.includes("[content_types].xml")) return false;
    return extension === ".docx" ? names.some((name) => name.startsWith("word/")) : names.some((name) => name.startsWith("xl/"));
  } catch {
    return false;
  }
}

export function validateUploadedFileBuffer(input: {
  buffer: Buffer;
  originalName: string;
  declaredMime?: string | null;
  allowedExtensions: ReadonlySet<string>;
}): SafeUploadResult {
  const originalBase = path.basename(String(input.originalName || ""));
  if (!originalBase || originalBase !== input.originalName || /[\u0000-\u001f\u007f]/.test(originalBase)) {
    return { ok: false, error: "Invalid upload filename." };
  }
  const extension = path.extname(originalBase).toLowerCase();
  if (!extension || !input.allowedExtensions.has(extension) || !MIME_BY_EXTENSION[extension]) {
    return { ok: false, error: "Unsupported upload file type." };
  }
  const declaredMime = String(input.declaredMime || "application/octet-stream").toLowerCase().split(";")[0].trim();
  if (!MIME_BY_EXTENSION[extension].includes(declaredMime)) {
    return { ok: false, error: "Uploaded file MIME type does not match its extension." };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    const detected = detectSafeImageType(input.buffer);
    if (!detected || !isDeclaredImageTypeCompatible(declaredMime, detected)) return { ok: false, error: "Invalid or forged image file." };
    const expectedExtension = extension === ".jpeg" ? ".jpg" : extension;
    if (detected.extension !== expectedExtension) return { ok: false, error: "Image content does not match its extension." };
    return { ok: true, extension: detected.extension, mime: detected.mime };
  }
  if (extension === ".pdf" && !isPdf(input.buffer)) return { ok: false, error: "Invalid or forged PDF file." };
  if ((extension === ".docx" || extension === ".xlsx") && !isExpectedOfficePackage(input.buffer, extension)) {
    return { ok: false, error: "Invalid or forged Office document." };
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    if (!isUtf8Text(input.buffer)) return { ok: false, error: "Text upload must be valid UTF-8 without binary content." };
    if (extension === ".json") {
      try { JSON.parse(input.buffer.toString("utf8")); } catch { return { ok: false, error: "Invalid JSON document." }; }
    }
  }
  return { ok: true, extension, mime: MIME_BY_EXTENSION[extension][0] };
}

export function validateUploadedFilePath(input: {
  filePath: string;
  originalName: string;
  declaredMime?: string | null;
  allowedExtensions: ReadonlySet<string>;
}): SafeUploadResult {
  const buffer = fs.readFileSync(input.filePath);
  return validateUploadedFileBuffer({ ...input, buffer });
}