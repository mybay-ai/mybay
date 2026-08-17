import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectScanTargets, findLocalEditionCopyIssues, findMissingRequiredTargets, REQUIRED_TARGETS } from "./check-local-edition-copy.mjs";

const temporaryRoots: string[] = [];
afterEach(() => temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("MyBay Open Source copy guard", () => {
  it.each(["云端部署与托管平台", "用户等级", "订阅套餐", "cloud hosting platform", "membership tier", "hosted instance", "生产级托管平台", "安全云托管", "hosted Agent", "MyBay hosting platform", "MyBay Local", "麦贝 Local", "麦贝Local", "麦贝本地版"])("rejects legacy SaaS or brand copy: %s", (phrase) => {
    expect(findLocalEditionCopyIssues("src/locales/en/marketing.json", `Legacy: ${phrase}`)).toEqual([expect.objectContaining({ phrase })]);
  });
  it("rejects a legacy brand even inside an otherwise allowed negative statement", () => {
    expect(findLocalEditionCopyIssues("src/locales/en/marketing.json", "MyBay Local does not provide cloud accounts.")).toEqual([
      expect.objectContaining({ phrase: "MyBay Local" }),
    ]);
  });
  it("allows an explicit Open Source negative statement", () => {
    expect(findLocalEditionCopyIssues("src/locales/en/marketing.json", "MyBay Open Source does not provide cloud accounts or subscription plans.")).toEqual([]);
    expect(findLocalEditionCopyIssues("src/locales/zh-CN/marketing.json", "MyBay Open Source 不提供云端账号或订阅套餐。")).toEqual([]);
  });
  it.each(["self-hosted Agent", "self-hosted instance"])("allows local self-hosted copy: %s", (phrase) => {
    expect(findLocalEditionCopyIssues("src/locales/en/marketing.json", `Run a ${phrase} on infrastructure you control.`)).toEqual([]);
  });
  it("still rejects a hosted offering when self-hosted copy appears on the same line", () => {
    expect(findLocalEditionCopyIssues("src/locales/en/marketing.json", "Choose a self-hosted Agent or a hosted Agent.")).toEqual([
      expect.objectContaining({ phrase: "hosted Agent" }),
    ]);
  });
  it("recursively scans every required public-copy scope", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-copy-"));
    temporaryRoots.push(root);
    for (const target of REQUIRED_TARGETS) {
      const absolute = path.join(root, target);
      if (path.extname(target)) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, "Local copy", "utf8");
      } else {
        fs.mkdirSync(absolute, { recursive: true });
        fs.writeFileSync(path.join(absolute, "nested.json"), "{}", "utf8");
      }
    }
    expect(findMissingRequiredTargets(root)).toEqual([]);
    expect(collectScanTargets(root)).toHaveLength(REQUIRED_TARGETS.length);
  });

  it.each([
    "Cloud transmission disconnected",
    "multi-tenant gateway proxying",
  ])("rejects product-capability copy: %s", (copy) => {
    expect(findLocalEditionCopyIssues("fixture.json", copy)).not.toHaveLength(0);
  });

  it.each([
    "MyBay does not support multi-tenant environments.",
    "MyBay is not a hosted service.",
    "Use a self-hosted gateway.",
  ])("allows explicit open-source non-goals: %s", (copy) => {
    expect(findLocalEditionCopyIssues("fixture.md", copy)).toHaveLength(0);
  });
});