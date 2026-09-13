import { describe, expect, it } from "vitest";
import { mapStoredChatMessage } from "./mapStoredChatMessage";
describe("stored message normalization", () => {
  it("preserves zero usage and persisted identity while accepting legacy requestId", () => {
    const message = mapStoredChatMessage({ id: "m1", role: "assistant", requestId: "legacy", conversation_id: "stored", usage_total_tokens: 0, duration_ms: 0 }, "fallback");
    expect(message.conversation_id).toBe("stored");
    expect(message.request_id).toBe("legacy");
    expect(message.usage_total_tokens).toBe(0);
    expect(message.duration_ms).toBe(0);
  });
  it("uses the requested conversation and keeps recovery metadata", () => {
    const metadata = { source: "history" };
    const message = mapStoredChatMessage({ id: "m2", role: "user", metadata }, "conversation-a");
    expect(message.conversation_id).toBe("conversation-a");
    expect(message.content).toBe("");
    expect(message.metadata).toBe(metadata);
    expect(message.usage_total_tokens).toBeNull();
  });
});
