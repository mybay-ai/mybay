import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../locales/en/dashboard/chatWorkspace.json";
import zh from "../../locales/zh-CN/dashboard/chatWorkspace.json";
import { ChatInputBar } from "./ChatInputBar";
import type { RunsCapabilityState } from "./runCapabilityProbe";

async function renderMode(state: RunsCapabilityState, mode: "quick" | "agent" = "agent", language = "en", sending = false, loadingConversations = false) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, interpolation: { escapeValue: false }, resources: {
    en: { dashboard: { chatWorkspace: en } }, "zh-CN": { dashboard: { chatWorkspace: zh } },
  } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatInputBar
    input="kept draft" attachmentConfig={{ allowedExtensions: null, maxFiles: null, maxFileSizeBytes: 1024 }}
    sending={sending} activeRunId={sending ? "restored-run" : null} isChatReady loadingConversations={loadingConversations}
    selectedChannel="web" chatMode={mode} onChatModeChange={vi.fn()} reasoningEffort="balanced" onReasoningEffortChange={vi.fn()}
    agentAvailable={state === "supported"} agentCapabilityState={state}
    onInputChange={vi.fn()} onSubmit={vi.fn()} onKeyDown={vi.fn()} onStopRun={vi.fn()}
  /></I18nextProvider>);
}

describe("restored Agent mode capability guard", () => {
  it.each(["checking", "disabled", "explicitly_unsupported", "unavailable"] as const)("retains mode/draft and visibly blocks sending when %s", async state => {
    const html = await renderMode(state);
    expect(html).toContain(en.modeAgent);
    expect(html).toContain("kept draft");
    expect(html).toContain('type="submit" disabled');
    expect(html).toContain('role="status"');
  });

  it.each(["en", "zh-CN"])("uses translated visible capability messaging (%s)", async language => {
    const html = await renderMode("unavailable", "agent", language);
    expect(html).toContain(renderToStaticMarkup(<>{language === "en" ? en.asyncRunsUnavailable : zh.asyncRunsUnavailable}</>));
    expect(html).not.toContain("dashboard:chatWorkspace.");
  });

  it("enables restored Agent sending only after a supported result", async () => {
    const html = await renderMode("supported");
    expect(html).not.toContain('type="submit" disabled');
    expect(html).not.toContain('role="status"');
  });

  it("keeps an explicitly chosen Quick mode usable when Agent capability is unavailable", async () => {
    const html = await renderMode("unavailable", "quick");
    expect(html).toContain(en.modeQuick);
    expect(html).not.toContain('type="submit" disabled');
  });

  it("keeps Stop usable for a recovered run even while capability is being checked", async () => {
    const html = await renderMode("checking", "agent", "en", true);
    const stop = html.match(new RegExp(`<button[^>]*aria-label="${en.stopTaskTitle}"[^>]*>`))?.[0];
    expect(stop).toBeDefined();
    expect(stop).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });

  it.each([["en", en.loadingConversations], ["zh-CN", zh.loadingConversations]] as const)(
    "blocks sending with a translated status while conversations restore (%s)",
    async (language, message) => {
      const html = await renderMode("supported", "agent", language, false, true);
      expect(html).toContain('type="submit" disabled');
      expect(html).toContain('role="status"');
      expect(html).toContain(message);
      expect(html).toContain("kept draft");
    },
  );
});
