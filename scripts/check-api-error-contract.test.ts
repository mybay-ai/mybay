import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanApiErrorContract } from "./check-api-error-contract.mjs";

const roots: string[] = [];
function source(text: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-api-contract-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "server"));
  fs.writeFileSync(path.join(root, "server", "route.ts"), text, "utf8");
  return scanApiErrorContract(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("API error contract guard", () => {
  it("rejects natural-language and raw error responses without code", () => {
    const issues = source(`
      res.status(400).json({ error: "实例不存在" });
      res.status(500).json({ message: err.message });
    `);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.rule === "api-error-without-code")).toBe(true);
  });

  it("allows the compatible migration shape with code and message", () => {
    expect(source(`res.status(400).json({ code: "INVALID_INSTANCE_ID", message: "实例 ID 无效" });`)).toEqual([]);
  });

  it("ignores success payloads and machine-readable errors", () => {
    expect(source(`
      res.json({ message: result.message });
      res.status(400).json({ error: "INVALID_INSTANCE_ID" });
    `)).toEqual([]);
  });
});