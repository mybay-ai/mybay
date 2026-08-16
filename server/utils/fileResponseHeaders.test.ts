import { describe, expect, it } from "vitest";
import { buildFileContentDisposition } from "./fileResponseHeaders";

describe("buildFileContentDisposition", () => {
  it("keeps an ASCII fallback and emits a UTF-8 filename", () => {
    expect(buildFileContentDisposition("部署报告 2026.pdf")).toBe(
      "attachment; filename=\"____ 2026.pdf\"; filename*=UTF-8''%E9%83%A8%E7%BD%B2%E6%8A%A5%E5%91%8A%202026.pdf"
    );
  });

  it("supports inline responses", () => {
    expect(buildFileContentDisposition("preview.png", "inline")).toBe(
      "inline; filename=\"preview.png\"; filename*=UTF-8''preview.png"
    );
  });

  it("removes response splitting characters and path separators", () => {
    const header = buildFileContentDisposition("../report\r\nX-Evil: yes.txt");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).toContain('filename=".._reportX-Evil: yes.txt"');
  });
});
