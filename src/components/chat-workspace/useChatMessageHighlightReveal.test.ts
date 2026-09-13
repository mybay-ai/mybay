import { describe, expect, it } from "vitest";
import { createChatMessageSelector } from "./useChatMessageHighlightReveal";

describe("chat message highlight selector", () => {
  it("builds a data selector for an ordinary message id", () => {
    expect(createChatMessageSelector("message-1")).toBe('[data-chat-message-id="message-1"]');
  });

  it("escapes quotes and backslashes when CSS.escape is unavailable", () => {
    expect(createChatMessageSelector('message"\\1')).toBe('[data-chat-message-id="message\\"\\\\1"]');
  });
});
