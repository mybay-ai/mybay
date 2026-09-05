import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it } from "vitest";
import { ChatMessageBubble } from "../ChatMessageBubble";
import { createRunExecutionState, reduceRunEvents } from "./runReducer";
import zh from "../../../locales/zh-CN/dashboard/chatWorkspace.json";

describe("interleaved run message rendering", () => {
  it("renders each narration once around its tool and keeps unsafe metadata out of the DOM", async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: "zh", resources: { zh: { dashboard: { chatWorkspace: zh } } } });
    const execution = reduceRunEvents(createRunExecutionState({ runId: "r", conversationId: "c" }), [
      { seq: 1, runId: "r", type: "text.delta", payload: { delta: "NarrationBefore." } },
      { seq: 2, runId: "r", type: "tool.started", payload: { id: "t", tool: "file", metadata: { file_path: "safe.html", command: "DO_NOT_RENDER" } } },
      { seq: 3, runId: "r", type: "tool.completed", payload: { id: "t", tool: "file" } },
      { seq: 4, runId: "r", type: "text.delta", payload: { delta: "FinalResponse." } },
    ]);
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatMessageBubble
      message={{ id: "m", role: "assistant", content: "NarrationBefore.FinalResponse.", conversation_id: "c", metadata: { run_id: "r" } }}
      selectedConversationId="c" sending onRetry={() => {}} runExecutionState={execution} /></I18nextProvider>);
    expect(html.split("NarrationBefore.")).toHaveLength(2);
    expect(html.split("FinalResponse.")).toHaveLength(2);
    expect(html.indexOf("NarrationBefore.")).toBeLessThan(html.indexOf("safe.html"));
    expect(html.indexOf("safe.html")).toBeLessThan(html.indexOf("FinalResponse."));
    expect(html).not.toContain("DO_NOT_RENDER");
    expect(html).toContain('aria-expanded="true"');
  });
});
