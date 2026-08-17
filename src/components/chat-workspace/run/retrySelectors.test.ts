import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import { findRetrySourceMessage } from "./retrySelectors";

const user = (id: string, requestId?: string): ChatMessage => ({ id, role: "user", content: id, request_id: requestId });
const assistant = (id: string, requestId?: string): ChatMessage => ({ id, role: "assistant", content: id, request_id: requestId });

describe("findRetrySourceMessage", () => {
  it("prefers the preceding user message with the same request id", () => {
    const messages = [user("u1", "r1"), assistant("a1", "r1"), user("u2", "r2"), assistant("a2", "r1")];
    expect(findRetrySourceMessage(messages, 3)?.id).toBe("u1");
  });

  it("falls back to the nearest preceding user message", () => {
    const messages = [user("u1"), assistant("a1")];
    expect(findRetrySourceMessage(messages, 1)?.id).toBe("u1");
  });

  it("returns undefined when no source user message exists", () => {
    expect(findRetrySourceMessage([assistant("a1")], 0)).toBeUndefined();
  });
});
