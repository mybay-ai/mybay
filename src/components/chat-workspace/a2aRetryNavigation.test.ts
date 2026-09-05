import { describe, expect, it } from "vitest";
import { A2A_RETRY_DRAFT_MAX_CHARS, isRetryableA2AStatus, readA2ARetryNavigationState, canReviewA2ARecovery, a2aRecoveryReason } from "./a2aRetryNavigation";

describe("A2A retry navigation", () => {
  it('carries a validated source only to its originating instance', () => {
    const a2aRecoverySource={contextId:'ctx-one',taskId:'task-one',peerId:'peer-one'};
    const state={a2aRetryDraft:'review',a2aRetryInstanceId:'source',a2aRecoverySource};
    expect(readA2ARetryNavigationState(state,'source')?.a2aRecoverySource).toEqual(a2aRecoverySource);
    expect(readA2ARetryNavigationState(state,'other')).toBeNull();
    expect(readA2ARetryNavigationState({...state,a2aRecoverySource:{...a2aRecoverySource,peerId:'../other'}},'source')?.a2aRecoverySource).toBeUndefined();
  });
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
  it('restricts recovery to outbound unfinished failures with a known peer', () => {
    for(const status of ['timed_out','unknown','auth_failed','failed','connection_failed','agent_offline']) {
      expect(canReviewA2ARecovery({direction:'outbound',peerId:'peer',status})).toBe(true);
      expect(canReviewA2ARecovery({direction:'inbound',peerId:'peer',status})).toBe(false);
      expect(canReviewA2ARecovery({direction:'outbound',peerId:null,status})).toBe(false);
    }
    for(const status of ['completed','in_progress','cancelled']) expect(canReviewA2ARecovery({direction:'outbound',peerId:'peer',status})).toBe(false);
    expect(a2aRecoveryReason('timed_out')).toBe('check_result');
    expect(a2aRecoveryReason('auth_failed')).toBe('check_auth');
    expect(a2aRecoveryReason('agent_offline')).toBe('check_service');
  });

});
