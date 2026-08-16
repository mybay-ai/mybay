import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  getFileDownloadBlob,
  isFileSelectableForDeletion,
  resolvePreviewResponse,
} from "./InstanceFilesSection";

describe("InstanceFilesSection file response contract", () => {
  it("downloads the original response as a blob without JSON parsing", async () => {
    const response = new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      headers: { "Content-Type": "application/pdf" },
    });
    const jsonSpy = vi.spyOn(response, "json");

    const blob = await getFileDownloadBlob(response);

    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(4);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("uses the response Content-Type instead of a stale list MIME", async () => {
    const response = new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png; charset=binary" },
    });

    const resolved = await resolvePreviewResponse(response, "text/plain");

    expect(resolved.kind).toBe("image");
    expect(resolved.mime).toBe("image/png");
  });

  it("keeps the JSON text preview envelope contract", async () => {
    await expect(resolvePreviewResponse({ content: "hello", mime: "text/plain" })).resolves.toEqual({
      kind: "text",
      mime: "text/plain",
      content: "hello",
    });
  });
});

describe("InstanceFilesSection deletion and mobile interaction contract", () => {
  it("only selects ordinary files in cleanup directories", () => {
    expect(isFileSelectableForDeletion({ type: "file", name: "report.pdf", path: "/outputs/report.pdf" })).toBe(true);
    expect(isFileSelectableForDeletion({ type: "file", name: "config.yaml", path: "/outputs/config.yaml" })).toBe(false);
    expect(isFileSelectableForDeletion({ type: "file", name: ".secret", path: "/outputs/.secret" })).toBe(false);
    expect(isFileSelectableForDeletion({ type: "file", name: "report.pdf", path: "/etc/report.pdf" })).toBe(false);
    expect(isFileSelectableForDeletion({ type: "directory", name: "outputs", path: "/outputs" })).toBe(false);
  });

  it("does not depend on double-click and exposes mobile actions", () => {
    const source = readFileSync(new URL("./InstanceFilesSection.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("onDoubleClick=");
    expect(source).toContain('closest("button,input,label")');
    expect(source).toContain("opacity-100 transition-opacity md:opacity-0");
    expect(source).not.toContain("shadow-2xs hidden md:flex");
  });
});
