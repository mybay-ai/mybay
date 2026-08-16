import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../repositories/chatRepo";
import { startRunsReconciler, stopRunsReconciler } from "./runsReconciler";

describe("Runs Reconciler independence from the creation gate", () => {
  afterEach(() => {
    stopRunsReconciler();
    delete process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("continues claiming existing runs when creation of new Interactive Runs is disabled", async () => {
    process.env.MYBAY_ASYNC_CHAT_RUNS_ENABLED = "false";
    vi.useFakeTimers();
    const claimRuns = vi.spyOn(chatRepo, "claimRuns").mockResolvedValue([]);

    await startRunsReconciler(5000, { allowInTest: true, cacheCleanupIntervalMs: 1000 });

    expect(claimRuns).toHaveBeenCalledOnce();
  });
});
