import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isNaturalLanguageText, scanHardcodedUi } from "./check-i18n-hardcode.mjs";

const roots: string[] = [];
function source(text: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-hardcode-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "Fixture.tsx"), text, "utf8");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("i18n UI hardcode guard", () => {
  it("allows reviewed technical tokens", () => {
    expect(isNaturalLanguageText("API URL")).toBe(false);
    expect(isNaturalLanguageText("WebGL")).toBe(false);
  });

  it("finds JSX, accessibility, browser and object copy", () => {
    const root = source(`
      const copy = { label: "Save configuration" };
      export const View = () => <button title="删除实例" aria-label="Delete instance">保存</button>;
      window.confirm("确定删除吗？");
    `);
    expect(scanHardcodedUi(root).map((issue) => issue.rule)).toEqual(expect.arrayContaining([
      "copy-property:label", "jsx-title", "jsx-aria-label", "jsx-text", "browser-copy:confirm",
    ]));
  });

  it("finds hand-written locale branches", () => {
    const root = source(`const isZh = true; export const value = isZh ? "保存" : "Save changes";`);
    expect(scanHardcodedUi(root)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "locale-branch" })]));
  });
});