import { describe, expect, it } from "vitest";
import { A2A_RETRY_DRAFT_MAX_CHARS, isRetryableA2AStatus, readA2ARetryNavigationState } from "./a2aRetryNavigation";

describe("A2A retry navigation", () => {
  it("accepts a bounded draft only for the selected instance", () => {
    expect(readA2ARetryNavigationState({
      a2aRetryDraft: "  retry peer  ",
      a2aRetryInstanceId: "source",
    }, "source")).toEqual({ a2aRetryDraft: "retry peer", a2aRetryInstanceId: "source" });
    expect(readA2ARetryNavigationState({
      a2aRetryDraft: "retry peer",
      a2aRetryInstanceId: "other",
    }, "source")).toBeNull();
  });

  it("rejects malformed or oversized navigation state", () => {
    expect(readA2ARetryNavigationState(null, "source")).toBeNull();
    expect(readA2ARetryNavigationState({
      a2aRetryDraft: "x".repeat(A2A_RETRY_DRAFT_MAX_CHARS + 1),
      a2aRetryInstanceId: "source",
    }, "source")).toBeNull();
  });

  it("offers retry only for transient or generic failures", () => {
    expect(isRetryableA2AStatus("connection_failed")).toBe(true);
    expect(isRetryableA2AStatus("timed_out")).toBe(true);
    expect(isRetryableA2AStatus("agent_offline")).toBe(true);
    expect(isRetryableA2AStatus("failed")).toBe(true);
    expect(isRetryableA2AStatus("auth_failed")).toBe(false);
    expect(isRetryableA2AStatus("cancelled")).toBe(false);
    expect(isRetryableA2AStatus("in_progress")).toBe(false);
    expect(isRetryableA2AStatus("completed")).toBe(false);
  });
});
