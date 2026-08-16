import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanI18nFallbacks } from "./check-i18n-fallbacks.mjs";

const roots: string[] = [];
function source(text: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-fallback-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "Fixture.tsx"), text, "utf8");
  return scanI18nFallbacks(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("i18n fallback guard", () => {
  it("rejects all legacy static fallback forms", () => {
    const issues = source(`
      t("one", "保存");
      t("two", { defaultValue: "Save" });
      t("three") || "Fallback";
    `);
    expect(issues.map((issue) => issue.rule)).toEqual(["t-second-argument", "t-default-value", "t-or-fallback"]);
  });

  it("allows interpolation options without defaultValue", () => {
    expect(source(`t("count", { count: 2 });`)).toEqual([]);
  });
});