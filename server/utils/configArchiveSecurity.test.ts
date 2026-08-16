import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { CONFIG_ARCHIVE_MAX_ENTRIES, CONFIG_ARCHIVE_MAX_ENTRY_BYTES, CONFIG_ARCHIVE_MAX_TOTAL_BYTES, validateConfigArchiveEntries } from "./configArchiveSecurity";

function entry(name: string, size = 1, compressedSize = size, externalFileAttr = 0) {
  return { entryName: name, isDirectory: false, header: { size, compressedSize, externalFileAttr } };
}

describe("config archive security", () => {
  it("accepts a normal in-memory MyBay archive", () => {
    const archive = new AdmZip();
    archive.addFile("manifest.json", Buffer.from('{"platform":"MyBay"}'));
    archive.addFile("config.redacted.json", Buffer.from("{}"));
    expect(validateConfigArchiveEntries(new AdmZip(archive.toBuffer()).getEntries())).toMatchObject({ ok: true });
  });

  it("enforces entry count and expanded size limits", () => {
    expect(validateConfigArchiveEntries(Array.from({ length: CONFIG_ARCHIVE_MAX_ENTRIES + 1 }, (_, index) => entry(`f-${index}`)))).toMatchObject({ ok: false, code: "ZIP_ENTRY_COUNT_LIMIT" });
    expect(validateConfigArchiveEntries([entry("large.bin", CONFIG_ARCHIVE_MAX_ENTRY_BYTES + 1)])).toMatchObject({ ok: false, code: "ZIP_ENTRY_SIZE_LIMIT" });
    expect(validateConfigArchiveEntries(Array.from({ length: 7 }, (_, index) => entry(`chunk-${index}`, 95 * 1024 * 1024, 1024 * 1024)))).toMatchObject({ ok: false, code: "ZIP_TOTAL_SIZE_LIMIT" });
    expect(CONFIG_ARCHIVE_MAX_TOTAL_BYTES).toBe(600 * 1024 * 1024);
  });

  it.each([["../secret", "ZIP_PATH_TRAVERSAL"], ["..\\secret", "ZIP_PATH_TRAVERSAL"], ["/etc/passwd", "ZIP_ABSOLUTE_PATH"], ["C:\\Windows\\secret", "ZIP_ABSOLUTE_PATH"], ["safe/./secret", "ZIP_PATH_TRAVERSAL"]])("rejects unsafe path %s", (name, code) => {
    expect(validateConfigArchiveEntries([entry(name)])).toMatchObject({ ok: false, code });
  });

  it("rejects symbolic links and compression bombs", () => {
    expect(validateConfigArchiveEntries([entry("link", 1, 1, 0xa000 << 16)])).toMatchObject({ ok: false, code: "ZIP_SYMLINK" });
    expect(validateConfigArchiveEntries([entry("compressed.bin", 20 * 1024 * 1024, 1024)])).toMatchObject({ ok: false, code: "ZIP_COMPRESSION_RATIO" });
  });
});
