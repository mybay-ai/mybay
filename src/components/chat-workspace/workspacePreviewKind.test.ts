import { describe, expect, it } from "vitest";
import { getWorkspacePreviewKind } from "./workspacePreviewKind";

describe("workspace preview kind", () => {
  it.each(["file.doc", "file.docx", "file.xls", "file.xlsx", "file.ppt", "file.pptx"])("recognizes Office file %s", (fileName) => {
    expect(getWorkspacePreviewKind(fileName)).toBe("office");
  });

  it.each(["component.ts", "component.tsx"])("renders TypeScript file %s as text", (fileName) => {
    expect(getWorkspacePreviewKind(fileName)).toBe("text");
  });

  it.each(["clip.mp4", "clip.mov"])("recognizes video file %s", (fileName) => {
    expect(getWorkspacePreviewKind(fileName)).toBe("video");
  });

  it("uses a declared video MIME type when the extension is unavailable", () => {
    expect(getWorkspacePreviewKind("clip.bin", "video/mp4")).toBe("video");
  });
});
