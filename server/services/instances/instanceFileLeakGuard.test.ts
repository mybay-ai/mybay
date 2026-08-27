import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { containsSecretContent, guardFileExport, isBlockedExportFileName } from "./instanceFileLeakGuard";

const tempFiles: string[] = [];

function makeTempFile(name: string, content: string): string {
  const filePath = path.join(os.tmpdir(), `mybay-file-guard-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content, "utf8");
  tempFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  for (const filePath of tempFiles.splice(0)) {
    try { fs.unlinkSync(filePath); } catch { /* already removed */ }
  }
});

describe("instanceFileLeakGuard", () => {
  it("blocks sensitive names and archives", () => {
    expect(isBlockedExportFileName(".env")).toBe(true);
    expect(isBlockedExportFileName("credentials.json")).toBe(true);
    expect(isBlockedExportFileName("report.zip")).toBe(true);
    expect(isBlockedExportFileName("report.pdf")).toBe(false);
  });

  it("detects common secret content", () => {
    expect(containsSecretContent("OPENAI_API_KEY=sk-123456789012345678901234")).toBe(true);
    expect(containsSecretContent("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(containsSecretContent("普通的业务报告内容")).toBe(false);
  });

  it("allows normal files and blocks secret text", async () => {
    const safeFile = makeTempFile("report.md", "# 报告\n这是正常内容。");
    const secretFile = makeTempFile("notes.txt", "token: abcdefghijklmnop");

    expect((await guardFileExport(safeFile)).ok).toBe(true);
    const blocked = await guardFileExport(secretFile);
    expect(blocked.ok).toBe(false);
    if (blocked.ok === false) expect(blocked.code).toBe("FILE_SECRET_CONTENT_BLOCKED");
  });

  it("rejects a canonical file outside the allowed instance root", async () => {
    const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-file-root-"));
    const outsideFile = makeTempFile("outside.md", "normal content");
    try {
      await expect(guardFileExport(outsideFile, "outside.md", allowedRoot))
        .resolves.toMatchObject({ ok: false, code: "FILE_OUTSIDE_INSTANCE_ROOT", status: 403 });
    } finally {
      fs.rmSync(allowedRoot, { recursive: true, force: true });
    }
  });
});
