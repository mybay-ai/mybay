import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../locales/en/dashboard/chatWorkspace.json";
import zh from "../../locales/zh-CN/dashboard/chatWorkspace.json";
import { ChatMessagesPanel } from "./ChatMessagesPanel";
import type { RunExecutionState } from "./run/runTypes";
import { createRunExecutionState } from "./run/runReducer";

async function renderPanel(language: string, paused: boolean, execution?: RunExecutionState) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, interpolation: { escapeValue: false }, resources: {
    en: { dashboard: { chatWorkspace: en } }, "zh-CN": { dashboard: { chatWorkspace: zh } },
  } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatMessagesPanel
    scrollContainerRef={createRef()} messagesEndRef={createRef()} selectedId="fixture" selectedConversationId="conversation"
    isChatReady instances={[{ id: "fixture" } as any]} loadingInstances={false} loadingMessages={false}
    messages={[{ id: "message-1", role: "user", content: "Synthetic message" }]}
    nextCursorSeq={null} loadingMoreMessages={false} sending={false} activeRunId={null} toolSteps={[]} error={null}
    onGoToInstanceManage={vi.fn()} onUsePrompt={vi.fn()} onLoadMoreMessages={vi.fn()} onRetry={vi.fn()}
    showJumpToLatest={paused} onJumpToLatest={vi.fn()}
    runExecutionState={execution}
  /></I18nextProvider>);
}

describe("chat scrolling accessibility and markup", () => {
  it("does not render a detached response from the previous conversation", async () => {
    const execution = createRunExecutionState({ runId: "old", conversationId: "previous", initialText: "FOREIGN_RESPONSE" });
    expect(await renderPanel("en", false, execution)).not.toContain("FOREIGN_RESPONSE");
  });
  it.each(["en", "zh-CN"])("exposes a keyboard-focusable pane and translated return control (%s)", async language => {
    const html = await renderPanel(language, true);
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-chat-message-id="message-1"');
    expect(html).toContain('overflow-anchor:none');
    expect(html).toContain(language === "en" ? 'aria-label="Conversation messages"' : 'aria-label="对话消息"');
    expect(html).toContain(language === "en" ? 'aria-label="Back to latest"' : 'aria-label="回到最新消息"');
    expect(html).not.toContain("chatWorkspace.jumpToLatest");
  });
  it("hides the return control while following", async () => {
    expect(await renderPanel("en", false)).not.toContain('aria-label="Back to latest"');
  });
  it("expands the message stream responsively on desktop", async () => {
    const html = await renderPanel("en", false);
    expect(html).toContain("max-w-5xl");
    expect(html).toContain("2xl:max-w-6xl");
  });
});
