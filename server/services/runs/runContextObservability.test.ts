import { describe, expect, it } from "vitest";
import { summarizeRunContextAssembly } from "./runContextObservability";

describe("run context observability", () => {
  it("reports current-only payload counts without retaining content", () => {
    const summary = summarizeRunContextAssembly({
      sessionState: "existing",
      historyDeduplicationConfigured: true,
      historyMessages: [{ content: "PRIVATE_HISTORY" }],
      currentMessage: "PRIVATE_CURRENT",
      attachmentContext: "PRIVATE_ATTACHMENT",
      payload: { input: "PRIVATE_CURRENT\n\nPRIVATE_ATTACHMENT" },
    });

    expect(summary).toEqual({
      version: 1,
      sessionState: "existing",
      historyDeduplicationConfigured: true,
      inputMode: "current_only",
      historyMessages: 1,
      historyChars: 15,
      currentMessageChars: 15,
      attachmentContextChars: 18,
      payloadMessages: 1,
      payloadChars: 35,
    });
    expect(JSON.stringify(summary)).not.toMatch(/PRIVATE/);
  });

  it("reports full-history payload size and handles Unicode by characters", () => {
    const summary = summarizeRunContextAssembly({
      sessionState: "fallback",
      historyDeduplicationConfigured: true,
      historyMessages: [{ content: "旧问题" }, { content: "旧回答" }],
      currentMessage: "新问题",
      payload: {
        input: [
          { role: "system", content: "策略" },
          { role: "user", content: "旧问题" },
          { role: "assistant", content: "旧回答" },
          { role: "user", content: "新问题" },
        ],
      },
    });

    expect(summary).toMatchObject({
      sessionState: "fallback",
      inputMode: "full_history",
      historyMessages: 2,
      historyChars: 6,
      currentMessageChars: 3,
      attachmentContextChars: 0,
      payloadMessages: 4,
      payloadChars: 11,
    });
  });

  it("fails closed to unknown shape without serializing unexpected values", () => {
    const summary = summarizeRunContextAssembly({
      sessionState: "private-session-id",
      historyDeduplicationConfigured: false,
      historyMessages: [],
      currentMessage: "",
      payload: { input: { prompt: "PRIVATE" } },
    });

    expect(summary).toMatchObject({ sessionState: "unknown", inputMode: "unknown", payloadMessages: 0, payloadChars: 0 });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE");
  });
});
