import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import * as XLSX from "@e965/xlsx";
import { afterEach, describe, expect, it } from "vitest";
import { escapeOfficePreviewHtml, extractLegacyPresentationText, renderLocalOfficePreview } from "./officeArtifactPreview";

const tempDirectories: string[] = [];
const createTempDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-office-preview-"));
  tempDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("office artifact preview", () => {
  it("escapes active markup before rendering office content", () => {
    expect(escapeOfficePreviewHtml('<img src=x onerror="alert(1)">'))
      .toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("extracts readable strings from legacy presentation buffers", () => {
    const buffer = Buffer.concat([Buffer.from("Quarterly results\0Hidden", "latin1"), Buffer.from("季度汇报", "utf16le")]);
    const text = extractLegacyPresentationText(buffer).join(" ");
    expect(text).toContain("Quarterly results");
    expect(text).toContain("季度汇报");
  });

  it("renders XLSX cells as escaped local tables", async () => {
    const filePath = path.join(createTempDirectory(), "report.xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Value"], ["<script>alert(1)</script>", 42]]), "Summary");
    XLSX.writeFile(workbook, filePath);
    const preview = await renderLocalOfficePreview(filePath);
    expect(preview.mode).toBe("spreadsheet");
    expect(preview.html).toContain("Summary");
    expect(preview.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(preview.html).not.toContain("<script>alert(1)</script>");
  });

  it("renders PPTX slide text without executing markup", async () => {
    const filePath = path.join(createTempDirectory(), "deck.pptx");
    const archive = new AdmZip();
    archive.addFile("ppt/slides/slide1.xml", Buffer.from('<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>&lt;img onerror=&quot;x&quot;&gt;</a:t></a:r></a:p></p:sld>'));
    archive.writeZip(filePath);
    const preview = await renderLocalOfficePreview(filePath);
    expect(preview.mode).toBe("presentation");
    expect(preview.html).toContain("Slide 1");
    expect(preview.html).toContain("&lt;img onerror=&quot;x&quot;&gt;");
    expect(preview.html).not.toContain("<img onerror");
  });

  it("renders DOCX body text locally", async () => {
    const filePath = path.join(createTempDirectory(), "document.docx");
    const archive = new AdmZip();
    archive.addFile("[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'));
    archive.addFile("word/document.xml", Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Local DOCX preview</w:t></w:r></w:p></w:body></w:document>'));
    archive.writeZip(filePath);
    const preview = await renderLocalOfficePreview(filePath);
    expect(preview.mode).toBe("document");
    expect(preview.html).toContain("Local DOCX preview");
  });
});
