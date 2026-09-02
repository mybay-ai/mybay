import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../repositories/chatRepo";
import { dbAdapter } from "../db";
import { completeRunFromRuntimeEvent, processSingleRun, requestRunsReconcile, startRunsReconciler, stopRunsReconciler } from "./runsReconciler";

describe("runs reconciler timer lifecycle", () => {
  afterEach(() => {
    stopRunsReconciler();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts reconcile and cache cleanup timers only once", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValue([]);
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    await startRunsReconciler(5000, { allowInTest: true, cacheCleanupIntervalMs: 1000 });
    await startRunsReconciler(5000, { allowInTest: true, cacheCleanupIntervalMs: 1000 });

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(chatRepo.claimRuns).toHaveBeenCalledTimes(1);
  });

  it("clears both timers when stopped", async () => {
    vi.useFakeTimers();
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValue([]);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    await startRunsReconciler(5000, { allowInTest: true, cacheCleanupIntervalMs: 1000 });
    stopRunsReconciler();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it("coalesces immediate reconcile signals without waiting for the interval", async () => {
    const claimRuns = vi.spyOn(chatRepo, "claimRuns").mockResolvedValue([]);

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await Promise.resolve();
    expect(requestRunsReconcile()).toBe(true);
    expect(requestRunsReconcile()).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(claimRuns).toHaveBeenCalledTimes(2);
  });

  it("finishes directly from a normalized Runtime event using upstream identity", async () => {
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue({
      id: "run-1",
      status: "running",
      upstream_run_id: "upstream-1",
    } as any);

    await completeRunFromRuntimeEvent(
      { id: "run-1", partial_output: "" },
      { status: "completed", assistantContent: "done" },
      "upstream-1"
    );

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      status: "completed",
      assistantContent: "done",
      expectedUpstreamRunId: "upstream-1",
      reconcilerId: undefined
    }));
  });

  it("rejects a stale run authority chain before reading messages or contacting Runtime", async () => {
    vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({
      id: "instance-1",
      owner_id: "owner-1",
      user_id: "owner-1",
    } as any);
    const getMessage = vi.spyOn(chatRepo, "getMessage");
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });

    await processSingleRun({
      id: "run-foreign",
      status: "queued",
      user_id: "other-owner",
      instance_id: "instance-1",
      conversation_id: "conversation-1",
      last_event_seq: 0,
    }, new Set());

    expect(getMessage).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-foreign",
      status: "failed",
      errorCode: "RUN_NOT_FOUND",
    }));
  });
});
