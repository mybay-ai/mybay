import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import zh from "../../locales/zh-CN/dashboard/base.json";
import en from "../../locales/en/dashboard/base.json";

const detailSource = readFileSync(new URL("./InstanceDetailPanel.tsx", import.meta.url), "utf8");
const logSource = readFileSync(new URL("../LogViewer.tsx", import.meta.url), "utf8");

describe("Instance detail mobile navigation", () => {
  it("keeps both navigation levels fully available without mobile horizontal clipping", () => {
    expect(detailSource).toContain("grid grid-cols-2 sm:flex");
    expect(detailSource).not.toContain("shrink-0 overflow-x-auto sm:overflow-visible");
    expect(logSource).toContain("grid grid-cols-3 sm:flex");
    expect(logSource).toContain("logBody.scrollTop = logBody.scrollHeight");
    expect(logSource).not.toContain("scrollIntoView");
  });

  it("provides localized compact labels for every log tab", () => {
    expect(zh.logs_tab_deploy_short).toBe("部署");
    expect(zh.logs_tab_runtime_short).toBe("运行");
    expect(zh.logs_tab_audit_short).toBe("审计");
    expect(en.logs_tab_deploy_short).toBe("Deploy");
    expect(en.logs_tab_runtime_short).toBe("Runtime");
    expect(en.logs_tab_audit_short).toBe("Audit");
  });
});
