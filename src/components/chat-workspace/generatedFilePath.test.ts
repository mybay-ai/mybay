import { describe, expect, it } from "vitest";
import { GENERATED_FILE_PATH_PATTERN, normalizeGeneratedInstanceFilePath } from "./generatedFilePath";

describe("generated instance file paths", () => {
  it.each([
    ["/opt/data/outputs/web/demo/index.html", "outputs/web/demo/index.html"],
    ["opt/data/codex_deck/deck.html", "codex_deck/deck.html"],
    ["outputs/documents/report.pdf", "outputs/documents/report.pdf"],
    ["./results/data.json", "results/data.json"],
    ["/opt/data/outputs/code/component.tsx", "outputs/code/component.tsx"],
    ["/opt/data/outputs/video/demo.mp4", "outputs/video/demo.mp4"],
    ["/opt/data/outputs/video/demo.mov", "outputs/video/demo.mov"],
  ])("normalizes approved path %s", (input, expected) => {
    expect(normalizeGeneratedInstanceFilePath(input)).toBe(expected);
  });

  it("discovers TypeScript and video artifacts in assistant text", () => {
    const text = "/opt/data/outputs/app.ts /opt/data/outputs/view.tsx /opt/data/outputs/demo.mp4 /opt/data/outputs/demo.mov";
    expect(Array.from(text.matchAll(GENERATED_FILE_PATH_PATTERN), match => match[0])).toEqual([
      "/opt/data/outputs/app.ts",
      "/opt/data/outputs/view.tsx",
      "/opt/data/outputs/demo.mp4",
      "/opt/data/outputs/demo.mov",
    ]);
  });

  it.each([
    "G:\\codex_deck\\deck.html",
    "C:/temp/deck.html",
    "\\\\server\\share\\deck.html",
    "/etc/report.html",
    "../outputs/report.html",
    "outputs/../secret.html",
  ])("rejects host or unsafe path %s", (input) => {
    expect(normalizeGeneratedInstanceFilePath(input)).toBeNull();
  });

  it("does not turn Windows host paths into clickable file tokens", () => {
    const text = "wrong G:\\codex_deck\\deck.html and C:/outputs/web/leak.html; correct /opt/data/outputs/web/deck/index.html";
    const matches = Array.from(text.matchAll(GENERATED_FILE_PATH_PATTERN), match => match[0]);
    expect(matches).toEqual(["/opt/data/outputs/web/deck/index.html"]);
  });
});
