import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import en from "../../locales/en/dashboard";
import zh from "../../locales/zh-CN/dashboard";
import { InstanceReadinessNotice } from "./InstanceReadinessNotice";
import { ChatGeneratedArtifactCards } from "../chat-workspace/ChatGeneratedArtifactCards";
import { ChatRunFileChanges } from "../chat-workspace/ChatRunFileChanges";

async function render(language: string, element: React.ReactElement) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, interpolation: { escapeValue: false }, resources: {
    en: { dashboard: en }, "zh-CN": { dashboard: zh },
  } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
}

describe("P0 evidence presentation", () => {
  it.each(["en", "zh-CN"])("keeps model and channel evidence separate in %s", async language => {
    const html = await render(language, <InstanceReadinessNotice instance={{ id: "fixture", status: "running", model_config_status: "written" } as any} chatReadiness={{ ready: true, checkedAt: "2026-08-31T00:00:00Z" }} />);
    expect(html).toContain('data-readiness-check="chat" data-check-status="ready"');
    expect(html).toContain('data-readiness-check="model_response" data-check-status="unknown"');
    expect(html).toContain('data-readiness-check="channels" data-check-status="unknown"');
    expect(html).not.toMatch(/readiness_check_status_|readiness_evidence_note/);
    expect(html).toContain(language === "en" ? "does not send a model request" : "不会调用模型");
  });

  it("keeps stopped-instance checks disabled despite a stale ready probe", async () => {
    const html = await render("en", <InstanceReadinessNotice instance={{ id: "fixture", status: "stopped", physical_status: "running" } as any} chatReadiness={{ ready: true }} />);
    expect(html).toContain('data-readiness-phase="stopped"');
    expect(html).toContain('disabled=""');
  });

  it.each(["en", "zh-CN"])("does not describe a referenced file as generated or added in %s", async language => {
    const artifact = { path: "report.html", name: "report.html", messageId: "message", runId: "run", requestId: null, status: "ready" as const };
    const html = await render(language, <><ChatGeneratedArtifactCards artifacts={[artifact]} /><ChatRunFileChanges artifacts={[artifact]} /></>);
    expect(html).toContain(language === "en" ? "Files referenced in this reply" : "本条回复引用的文件");
    expect(html).toContain(language === "en" ? "Related files (1)" : "相关文件（1）");
    expect(html).not.toMatch(/1 added|新增 1|本次生成文件|Files generated in this run/);
  });
});
