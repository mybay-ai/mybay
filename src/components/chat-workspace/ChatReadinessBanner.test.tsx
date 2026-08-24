import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import { ChatReadinessBanner } from "./ChatReadinessBanner";

async function renderBanner(channelLabel: string, readinessMessage: string, options: { channel?: string; runtimeReady?: boolean } = {}) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    interpolation: { escapeValue: false },
    resources: {
      en: {
        dashboard: {
          readiness_runtime_ready_chat_initializing_title: "Instance running, chat initializing",
          chatWorkspace: {
            externalChannelTitle: "External channel",
            externalChannelDesc: "Channel: <strong>{{channel}}</strong>",
            externalChannelTip: "Reason: <strong>{{reason}}</strong>",
            externalChannelFallback: "external",
            portNotReadyFallback: "not ready",
            statusNotReady: "not ready",
            runtimeReadyChatPendingTitle: "Instance running, chat not ready",
            runtimeReadyChatPendingTip: "Check chat configuration",
          },
        },
      },
    },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ChatReadinessBanner
        selectedId="instance-1"
        isChatReady={false}
        selectedInstance={{ configSummary: { channel: options.channel || "telegram", channelLabel } } as any}
        selectedReadiness={{ ready: false, runtimeReady: options.runtimeReady, reason: "UNMAPPED", message: readinessMessage }}
      />
    </I18nextProvider>,
  );
}

describe("ChatReadinessBanner interpolation", () => {
  it("renders ordinary values and translation strong tags", async () => {
    const html = await renderBanner("Telegram", "warming up");
    expect(html).toContain("<strong>Telegram</strong>");
    expect(html).toContain("<strong>warming up</strong>");
  });

  it("renders script and image payloads as escaped text nodes", async () => {
    const html = await renderBanner("<script>alert(1)</script>", '<img src=x onerror="alert(2)">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("onerror=\"alert(2)\"");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
  });

  it("distinguishes a running instance from chat readiness", async () => {
    const html = await renderBanner("Web", "chat API disabled", { channel: "web", runtimeReady: true });
    expect(html).toContain("Instance running, chat initializing");
    expect(html).toContain("Check chat configuration");
  });
});
