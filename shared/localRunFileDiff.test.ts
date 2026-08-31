import { describe, expect, it } from "vitest";
import { buildFileDiffLines } from "./localRunFileDiff";

describe("bounded file text comparison", () => {
  it("keeps line numbers and unchanged context around an edit", () => {
    expect(buildFileDiffLines("head\nold\ntail\n", "head\nnew\ntail\n")).toEqual([
      { kind: "same", text: "head", before: 1, after: 1 },
      { kind: "removed", text: "old", before: 2 },
      { kind: "added", text: "new", after: 2 },
      { kind: "same", text: "tail", before: 3, after: 3 },
      { kind: "same", text: "", before: 4, after: 4 },
    ]);
  });
  it("distinguishes a missing file from an empty file in its input contract", () => {
    expect(buildFileDiffLines(null, "a")).toEqual([{ kind: "added", text: "a", after: 1 }]);
    expect(buildFileDiffLines("a", null)).toEqual([{ kind: "removed", text: "a", before: 1 }]);
    expect(buildFileDiffLines("", "")).toEqual([]);
    expect(buildFileDiffLines("a", "a\n").at(-1)).toEqual({ kind: "added", text: "", after: 2 });
  });
  it("reconstructs both originals even when the LCS budget is exceeded", () => {
    const before = Array.from({ length: 600 }, (_, i) => `old-${i}`).join("\n");
    const after = Array.from({ length: 600 }, (_, i) => `new-${i}`).join("\n");
    const lines = buildFileDiffLines(before, after);
    expect(lines.filter(l => l.kind !== "added").map(l => l.text).join("\n")).toBe(before);
    expect(lines.filter(l => l.kind !== "removed").map(l => l.text).join("\n")).toBe(after);
  });
});
