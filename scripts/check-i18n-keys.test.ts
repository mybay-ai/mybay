import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLocaleParity, flattenLocaleKeys, listJsonFiles } from "./check-i18n-keys.mjs";

const tempRoots: string[] = [];
function fixture(files: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-i18n-"));
  tempRoots.push(root);
  for (const [relativePath, value] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(value), "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("recursive i18n key parity", () => {
  it("recursively discovers nested locale files", () => {
    const root = fixture({ "zh-CN/dashboard/base.json": { title: "标题" } });
    expect(listJsonFiles(path.join(root, "zh-CN"))).toEqual(["dashboard/base.json"]);
  });

  it("treats arrays as leaf values", () => {
    expect([...flattenLocaleKeys({ guide: { steps: ["one"] } })]).toEqual(["guide.steps"]);
  });

  it("reports nested files and leaf keys missing in either locale", () => {
    const root = fixture({
      "zh-CN/dashboard/base.json": { title: "标题", onlyZh: "仅中文" },
      "en/dashboard/base.json": { title: "Title", onlyEn: "English only" },
      "zh-CN/dashboard/extra.json": { title: "额外" },
    });
    expect(checkLocaleParity(root).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "missing-key", locale: "en", file: "dashboard/base.json", key: "onlyZh" }),
      expect.objectContaining({ type: "missing-key", locale: "zh-CN", file: "dashboard/base.json", key: "onlyEn" }),
      expect.objectContaining({ type: "missing-file", locale: "en", file: "dashboard/extra.json" }),
    ]));
  });
});