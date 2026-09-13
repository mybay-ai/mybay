import { describe, expect, it } from "vitest";
import { createLocalRunUsage } from "../../../shared/localRunUsage";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { selectConversationContextUsage } from "./conversationContextUsage";

function assistant(id: string, usage: unknown, status: ChatMessage["status"] = "completed"): ChatMessage {
  return { id, role: "assistant", content: id, status, metadata: { usage_evidence: usage } };
}

describe("conversation context usage", () => {
  it("selects the newest completed assistant context snapshot", () => {
    const older = createLocalRunUsage({ context_tokens: 100, context_window: 1_000 });
    const newer = createLocalRunUsage({ context_tokens: 250, context_window: 1_000, context_percent: 25 });
    expect(selectConversationContextUsage([
      assistant("older", older),
      { id: "user", role: "user", content: "question", status: "completed" },
      assistant("newer", newer),
    ])?.contextTokens).toBe(250);
  });

  it("ignores pending and non-context usage snapshots", () => {
    const pending = createLocalRunUsage({ context_tokens: 400 });
    const tokenOnly = createLocalRunUsage({ total_tokens: 20 });
    expect(selectConversationContextUsage([
      assistant("completed", tokenOnly),
      assistant("pending", pending, "pending"),
    ])).toBeNull();
  });

  it("accepts a terminal compaction snapshot without token counts", () => {
    const compacted = createLocalRunUsage({ compaction_status: "completed" });
    expect(selectConversationContextUsage([assistant("compacted", compacted)])?.compactionStatus).toBe("completed");
  });
});
