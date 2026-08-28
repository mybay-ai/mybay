import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRunReconcileScheduler,
  processClaimedRunsByInstance,
  resolveRunReconcilerClaimLimit,
  resolveRunReconcilerConcurrency,
} from "./runReconcileScheduler";

function createHarness(claim = vi.fn(async () => [] as Array<{ id: string }>)) {
  const lostRunIds = new Set<string>();
  const stopRenewal = vi.fn();
  const release = vi.fn(async () => true);
  const claimById = vi.fn(async (runId: string) => ({ id: runId }));
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
      claimById,
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
    claimById,
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

  it("dispatches a targeted run while the broad reconciliation claim is blocked", async () => {
    let releaseBroadClaim!: () => void;
    const broadClaim = new Promise<Array<{ id: string }>>((resolve) => {
      releaseBroadClaim = () => resolve([]);
    });
    const harness = createHarness(vi.fn(() => broadClaim));

    await harness.scheduler.start(60_000, { allowInTest: true });
    expect(harness.scheduler.requestRun("11111111-1111-4111-8111-111111111111")).toBe(true);

    await vi.waitFor(() => {
      expect(harness.processRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }),
        expect.any(Set),
      );
    });
    expect(harness.claimById).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");

    releaseBroadClaim();
    harness.scheduler.stop();
  });

  it("clamps concurrency and scales the claim window", () => {
    expect(resolveRunReconcilerConcurrency(undefined)).toBe(4);
    expect(resolveRunReconcilerConcurrency(0)).toBe(1);
    expect(resolveRunReconcilerConcurrency(99)).toBe(16);
    expect(resolveRunReconcilerClaimLimit(4)).toBe(12);
    expect(resolveRunReconcilerClaimLimit(16)).toBe(48);
  });

  it("runs different instances concurrently while serializing the same instance", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const started: string[] = [];
    const completed: string[] = [];

    const processing = processClaimedRunsByInstance([
      { id: "a-1", instance_id: "instance-a" },
      { id: "a-2", instance_id: "instance-a" },
      { id: "b-1", instance_id: "instance-b" },
    ], 2, async (run) => {
      started.push(run.id);
      if (run.id === "a-1") await gateA;
      completed.push(run.id);
    });

    await vi.waitFor(() => expect(started).toContain("b-1"));
    expect(started).not.toContain("a-2");
    releaseA();
    await processing;

    expect(started.indexOf("a-1")).toBeLessThan(started.indexOf("a-2"));
    expect(completed).toContain("b-1");
  });
});
