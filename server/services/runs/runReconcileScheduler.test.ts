import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunReconcileScheduler } from "./runReconcileScheduler";

function createHarness(claim = vi.fn(async () => [] as Array<{ id: string }>)) {
  const lostRunIds = new Set<string>();
  const stopRenewal = vi.fn();
  const release = vi.fn(async () => true);
  const processRun = vi.fn(async () => undefined);
  const emitClaimed = vi.fn();
  const cleanupInactiveCaches = vi.fn();
  const clearStreams = vi.fn();
  const scheduler = createRunReconcileScheduler({
    ownerId: "reconciler-1",
    isTestEnvironment: () => true,
    createLeaseController: () => ({
      lostRunIds,
      claim,
      startRenewal: vi.fn(() => stopRenewal),
      hasLost: (runId) => lostRunIds.has(runId),
      release
    }),
    emitClaimed,
    processRun,
    cleanupInactiveCaches,
    clearStreams,
    logStarted: vi.fn(),
    logError: vi.fn()
  });
  return {
    scheduler,
    claim,
    lostRunIds,
    stopRenewal,
    release,
    processRun,
    emitClaimed,
    cleanupInactiveCaches,
    clearStreams
  };
}

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe("runReconcileScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects wake requests before start and after stop", async () => {
    const { scheduler } = createHarness();
    expect(scheduler.requestReconcile()).toBe(false);

    await scheduler.start(60_000, { allowInTest: true });
    scheduler.stop();
    expect(scheduler.requestReconcile()).toBe(false);
  });

  it("starts both timers once and runs an immediate cycle", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { scheduler, claim } = createHarness();

    await scheduler.start(5_000, { allowInTest: true, cacheCleanupIntervalMs: 1_000 });
    await scheduler.start(5_000, { allowInTest: true, cacheCleanupIntervalMs: 1_000 });
    await flushMicrotasks();

    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it("coalesces multiple wake requests into one additional cycle", async () => {
    const { scheduler, claim } = createHarness();
    await scheduler.start(60_000, { allowInTest: true });
    await flushMicrotasks();

    expect(scheduler.requestReconcile()).toBe(true);
    expect(scheduler.requestReconcile()).toBe(true);
    expect(scheduler.requestReconcile()).toBe(true);
    await flushMicrotasks();

    expect(claim).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("processes a claimed run before release and stops renewal afterward", async () => {
    const order: string[] = [];
    const claim = vi.fn(async () => [{ id: "run-1" }]);
    const harness = createHarness(claim);
    harness.processRun.mockImplementation(async () => { order.push("process"); });
    harness.release.mockImplementation(async () => { order.push("release"); return true; });
    harness.stopRenewal.mockImplementation(() => { order.push("stop-renewal"); });

    await harness.scheduler.start(60_000, { allowInTest: true });
    await vi.waitFor(() => expect(harness.release).toHaveBeenCalledOnce());

    expect(order).toEqual(["process", "release", "stop-renewal"]);
    expect(harness.emitClaimed).toHaveBeenCalledWith({ id: "run-1" });
    harness.scheduler.stop();
  });
});
