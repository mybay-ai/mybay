import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../locales/en/dashboard/base.json";
import zh from "../../locales/zh-CN/dashboard/base.json";

const tabConfig = readFileSync(new URL("../dashboard/dashboardTabs.config.ts", import.meta.url), "utf8");

describe("Agent version repository naming", () => {
  it("uses the same localized product name in navigation and page metadata", () => {
    expect(zh.nav.versions).toBe("Agent 版本仓库");
    expect(zh.tabs.versions.label).toBe("Agent 版本仓库");
    expect(zh.tabs.versions.title).toBe("Agent 版本仓库");
    expect(zh.page_titles.versions).toBe("Agent 版本仓库 - 麦贝");
    expect(en.nav.versions).toBe("Agent Version Repository");
    expect(en.tabs.versions.label).toBe("Agent Version Repository");
    expect(en.tabs.versions.title).toBe("Agent Version Repository");
    expect(en.page_titles.versions).toBe("Agent Version Repository - MyBay");
    expect(tabConfig).toMatch(/key: "versions",\s+label: "",\s+title: "",\s+description: ""/);
    expect(tabConfig).not.toContain('title: "Agent Versions"');
  });
});
