import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readOnlyZip } from "./readOnlyZip";

describe("read-only ZIP parser", () => {
  it("inflates only selected members while retaining bounded metadata", () => {
    const archive = zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "ignored/cache.bin": new Uint8Array([1, 2, 3]),
    });
    const entries = readOnlyZip(archive, { include: name => name === "manifest.json" });

    expect(entries.map(entry => entry.entryName)).toEqual(["manifest.json", "ignored/cache.bin"]);
    expect(entries[0].getData().toString("utf8")).toBe('{"ok":true}');
    expect(() => entries[1].getData()).toThrow(/ZIP_ENTRY_NOT_SELECTED/);
  });

  it("rejects traversal paths before returning archive contents", () => {
    const archive = zipSync({ "../escape.txt": strToU8("blocked") });
    expect(() => readOnlyZip(archive)).toThrow(/ZIP_PATH_TRAVERSAL/);
  });

  it("rejects expanded-size and compression-ratio limit violations", () => {
    const archive = zipSync({ "large.txt": strToU8("a".repeat(1024)) }, { level: 9 });
    expect(() => readOnlyZip(archive, { limits: { maxEntryBytes: 100 } })).toThrow(/ZIP_ENTRY_SIZE_LIMIT/);
    expect(() => readOnlyZip(archive, {
      limits: { ratioMinBytes: 1, maxCompressionRatio: 2 },
    })).toThrow(/ZIP_COMPRESSION_RATIO/);
  });
});
