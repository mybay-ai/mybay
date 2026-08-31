import { describe, expect, it } from "vitest";
import { createConversationTitle } from "./conversationTitleText";

describe("automatic conversation titles", () => {
  it("preserves distinguishing text beyond the previous 24-character cutoff", () => {
    const message = "P2 attachment acceptance: offline recovery and download to disk";
    expect(createConversationTitle(message, "New chat")).toBe(message);
  });
  it("normalizes whitespace and keeps the localized empty fallback", () => {
    expect(createConversationTitle("  hello\n world\t", "新对话")).toBe("hello world");
    expect(createConversationTitle(" \n\t", "新对话")).toBe("新对话");
  });
  it("respects the API limit without splitting emoji", () => {
    expect(createConversationTitle("研".repeat(80), "")).toBe("研".repeat(80));
    expect(createConversationTitle("研".repeat(81), "")).toBe("研".repeat(79) + "…");
    expect(createConversationTitle("😀".repeat(60), "")).toBe("😀".repeat(39) + "…");
    expect(createConversationTitle("a".repeat(78) + "😀b", "")).toBe("a".repeat(78) + "…");
  });
});
