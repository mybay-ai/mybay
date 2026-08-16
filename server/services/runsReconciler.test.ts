import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../repositories/chatRepo";
import { completeRunFromHermesEvent, requestRunsReconcile, startRunsReconciler, stopRunsReconciler, toHermesReasoningModelOptions } from "./runsReconciler";

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

  it("maps UI reasoning choices to Hermes request model options", () => {
    expect(toHermesReasoningModelOptions("fast")).toEqual({
      reasoning: { enabled: true, effort: "low" },
      reasoning_effort: "low"
    });
    expect(toHermesReasoningModelOptions("balanced")).toEqual({
      reasoning: { enabled: true, effort: "medium" },
      reasoning_effort: "medium"
    });
    expect(toHermesReasoningModelOptions("deep")).toEqual({
      reasoning: { enabled: true, effort: "high" },
      reasoning_effort: "high"
    });
  });

  it("finishes directly from a terminal Hermes event using upstream identity", async () => {
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);

    await completeRunFromHermesEvent(
      { id: "run-1", partial_output: "" },
      { event: "run.completed", output: "done" },
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
});
