import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import dashboard from "../../locales/zh-CN/dashboard/base.json";
import deploy from "../../locales/zh-CN/deploy.json";
import { QuickDeployDelivery } from "./QuickDeployDelivery";

describe("QuickDeployDelivery i18n rendering", () => {
  it("renders localized conversation readiness and deployment status", async () => {
    const instanceI18n = i18n.createInstance();
    await instanceI18n.use(initReactI18next).init({
      lng: "zh-CN",
      fallbackLng: "zh-CN",
      interpolation: { escapeValue: false },
      resources: { "zh-CN": { dashboard, deploy } },
    });

    const html = renderToStaticMarkup(
      <I18nextProvider i18n={instanceI18n}>
        <QuickDeployDelivery
          created={{ id: "instance-1", status: "deploying" }}
          onInstanceUpdated={() => undefined}
          onOpenChat={() => undefined}
          onViewInstances={() => undefined}
        />
      </I18nextProvider>,
    );

    expect(html).toContain("对话就绪状态");
    expect(html).toContain("部署中");
    expect(html).not.toContain(">deploying<");
  });
});
