import React, { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../locales/en/dashboard/chatWorkspace.json";
import zh from "../../locales/zh-CN/dashboard/chatWorkspace.json";
import { ChatMessagesPanel, type ChatMessagesPanelProps } from "./ChatMessagesPanel";
import type { RunExecutionState } from "./run/runTypes";
import { createRunExecutionState } from "./run/runReducer";

type PanelOverrides = {
  [Key in keyof ChatMessagesPanelProps]?: Partial<NonNullable<ChatMessagesPanelProps[Key]>>;
};

async function renderPanel(
  language: string,
  paused: boolean,
  execution?: RunExecutionState,
  highlightedMessageId?: string,
  overrides: PanelOverrides = {}
) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: language, interpolation: { escapeValue: false }, resources: {
    en: { dashboard: { chatWorkspace: en } }, "zh-CN": { dashboard: { chatWorkspace: zh } },
  } });
  const baseProps: ChatMessagesPanelProps = {
    viewport: {
      scrollContainerRef: createRef(),
      messagesEndRef: createRef(),
      showJumpToLatest: paused,
      onJumpToLatest: vi.fn(),
      highlightedMessageId
    },
    instance: {
      selectedId: "fixture",
      isChatReady: true,
      instances: [{ id: "fixture" } as any],
      loadingInstances: false
    },
    history: {
      loadingMessages: false,
      messages: [{ id: "message-1", role: "user", content: "Synthetic message" }],
      nextCursorSeq: null,
      loadingMoreMessages: false,
      selectedConversationId: "conversation",
      error: null
    },
    run: {
      sending: false,
      activeRunId: null,
      toolSteps: [],
      runExecutionState: execution
    },
    actions: {
      onGoToInstanceManage: vi.fn(),
      onUsePrompt: vi.fn(),
      onLoadMoreMessages: vi.fn(),
      onRetry: vi.fn()
    }
  };
  const props: ChatMessagesPanelProps = {
    ...baseProps,
    viewport: { ...baseProps.viewport, ...overrides.viewport },
    instance: { ...baseProps.instance, ...overrides.instance },
    history: { ...baseProps.history, ...overrides.history },
    run: { ...baseProps.run, ...overrides.run },
    resources: { ...baseProps.resources, ...overrides.resources },
    actions: { ...baseProps.actions, ...overrides.actions }
  };
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatMessagesPanel {...props} /></I18nextProvider>);
}

describe("chat scrolling accessibility and markup", () => {
  it("does not render a detached response from the previous conversation", async () => {
    const execution = createRunExecutionState({ runId: "old", conversationId: "previous", initialText: "FOREIGN_RESPONSE" });
    expect(await renderPanel("en", false, execution)).not.toContain("FOREIGN_RESPONSE");
  });
  it("renders a detached response owned by the selected conversation", async () => {
    const execution = createRunExecutionState({ runId: "current", conversationId: "conversation", initialText: "CURRENT_RESPONSE" });
    expect(await renderPanel("en", false, execution)).toContain("CURRENT_RESPONSE");
  });
  it("marks the selected search result for visual highlighting", async () => {
    const html = await renderPanel("en", false, undefined, "message-1");
    expect(html).toContain("ring-indigo-400");
  });
  it("prioritizes the no-instances state over message history", async () => {
    const html = await renderPanel("en", false, undefined, undefined, { instance: { instances: [] } });
    expect(html).toContain("No ready Agent instances found");
    expect(html).not.toContain("Synthetic message");
  });
  it("shows the blocking history loader before an empty welcome state", async () => {
    const html = await renderPanel("en", false, undefined, undefined, { history: { messages: [], loadingMessages: true } });
    expect(html).toContain("Loading chat history...");
  });
  it("preserves pagination and error notices around the message list", async () => {
    const html = await renderPanel("en", false, undefined, undefined, { history: { nextCursorSeq: 10, error: "PANEL_TEST_ERROR" } });
    expect(html).toContain("Load earlier messages");
    expect(html).toContain("Communication Exception");
    expect(html).toContain("PANEL_TEST_ERROR");
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
