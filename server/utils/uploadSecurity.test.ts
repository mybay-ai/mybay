import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { hasZipMagic, validateUploadedFileBuffer } from "./uploadSecurity";

const allowed = new Set([".pdf", ".docx", ".xlsx", ".txt", ".json", ".png"]);
const validate = (buffer: Buffer, originalName: string, declaredMime: string) => validateUploadedFileBuffer({ buffer, originalName, declaredMime, allowedExtensions: allowed });

describe("upload security", () => {
  it("accepts real PDF and rejects extension or MIME forgery", () => {
    expect(validate(Buffer.from("%PDF-1.7\nbody"), "report.pdf", "application/pdf").ok).toBe(true);
    expect(validate(Buffer.from("<script>alert(1)</script>"), "report.pdf", "application/pdf").ok).toBe(false);
    expect(validate(Buffer.from("%PDF-1.7"), "report.pdf", "text/html").ok).toBe(false);
  });

  it("rejects traversal names and binary text", () => {
    expect(validate(Buffer.from("hello"), "../note.txt", "text/plain").ok).toBe(false);
    expect(validate(Buffer.from([0x41, 0, 0x42]), "note.txt", "text/plain").ok).toBe(false);
  });

  it("validates JSON syntax", () => {
    expect(validate(Buffer.from('{"ok":true}'), "data.json", "application/json").ok).toBe(true);
    expect(validate(Buffer.from("{broken"), "data.json", "application/json").ok).toBe(false);
  });

  it("validates OOXML package structure", () => {
    const docx = new AdmZip();
    docx.addFile("[Content_Types].xml", Buffer.from("<Types/>"));
    docx.addFile("word/document.xml", Buffer.from("<document/>"));
    const data = docx.toBuffer();
    expect(hasZipMagic(data)).toBe(true);
    expect(validate(data, "file.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").ok).toBe(true);
    expect(validate(data, "file.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").ok).toBe(false);
  });

  it("rejects fake images", () => {
    expect(validate(Buffer.from("not png"), "image.png", "image/png").ok).toBe(false);
  });
});