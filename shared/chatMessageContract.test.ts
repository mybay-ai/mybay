import { describe, expect, it } from "vitest";
import {
  CHAT_CONTEXT_CHAR_BUDGET,
  MAX_CHAT_USER_MESSAGE_CHARS,
  countChatMessageCharacters,
  isChatUserMessageTooLong,
  selectRecentMessagesForContext,
  truncateMessageForContext
} from "./chatMessageContract";

describe("chat message contract", () => {
  it("enforces one Unicode-aware user-message limit", () => {
    expect(MAX_CHAT_USER_MESSAGE_CHARS).toBe(20_000);
    expect(isChatUserMessageTooLong("a".repeat(MAX_CHAT_USER_MESSAGE_CHARS))).toBe(false);
    expect(isChatUserMessageTooLong("😀".repeat(MAX_CHAT_USER_MESSAGE_CHARS + 1))).toBe(true);
    expect(countChatMessageCharacters("😀")).toBe(1);
  });

  it("keeps recent messages inside the shared context budget", () => {
    const messages = [
      { id: "old", content: "a".repeat(CHAT_CONTEXT_CHAR_BUDGET) },
      { id: "recent", content: "recent" }
    ];
    const selected = selectRecentMessagesForContext(messages);
    expect(selected.at(-1)?.id).toBe("recent");
    expect(selected.map(item => countChatMessageCharacters(item.content)).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CHAT_CONTEXT_CHAR_BUDGET);
  });

  it("deterministically truncates the nearest oversized message", () => {
    const result = truncateMessageForContext("HEAD" + "x".repeat(100) + "TAIL", 40);
    expect(countChatMessageCharacters(result)).toBe(40);
    expect(result).toContain("[truncated for context]");
    expect(result.startsWith("H")).toBe(true);
    expect(result.endsWith("L")).toBe(true);
  });
});