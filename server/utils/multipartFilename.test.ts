import { describe, expect, it } from "vitest";
import { normalizeMultipartFilename } from "./multipartFilename";

describe("normalizeMultipartFilename", () => {
  it("repairs UTF-8 Chinese filenames decoded as Latin-1", () => {
    const mojibake = Buffer.from("8月3日.mp4", "utf8").toString("latin1");
    expect(normalizeMultipartFilename(mojibake)).toBe("8月3日.mp4");
  });

  it.each(["report.mp4", "中文报告.docx", "résumé.pdf"])('preserves an already-correct filename: %s', (filename) => {
    expect(normalizeMultipartFilename(filename)).toBe(filename);
  });
});
