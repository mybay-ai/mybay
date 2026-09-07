import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findMojibakeIssues, scanProject } from "./check-mojibake.mjs";

describe("mojibake scanner", () => {
  it("accepts valid Chinese, English, em dashes and smart quotes", () => {
    expect(findMojibakeIssues("中文\nEnglish\n—\n“quotes”")).toEqual([]);
  });

  it("detects typical UTF-8 decoded as Latin-1 sequences", () => {
    const invalid = [
      "\u00e2\u0080\u0094",
      "\u00e2\u0080\u0099",
      "\u00c3\u00a9"
    ].join("\n");
    expect(findMojibakeIssues(invalid)).toHaveLength(3);
  });

  it("ignores dependency backup directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-mojibake-"));
    try {
      fs.mkdirSync(path.join(root, "node_modules.codex-backup"));
      fs.writeFileSync(path.join(root, "node_modules.codex-backup", "bad.js"), "const value = 'tÃ©st';");
      fs.writeFileSync(path.join(root, "source.ts"), "export const value = '中文';");
      expect(scanProject(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
