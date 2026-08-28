import { describe, expect, it, vi } from "vitest";
import { recoverStoppingRun, type RunStopRecoveryDependencies } from "./runStopRecovery";
import { HERMES_RUNTIME_CAPABILITIES } from "./runtimeCapabilityConsumers";

const now = Date.parse("2026-08-28T08:00:00.000Z");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    instance_id: "instance-1",
    status: "stopping",
    upstream_run_id: "upstream-1",
    dispatch_attempts: 1,
    stop_attempts: 1,
    stop_requested_at: new Date(now - 10_000).toISOString(),
    ...overrides,
  };
}

function harness(responses: Array<any> = []): RunStopRecoveryDependencies & { completeRun: any; updateRun: any; requestRuns: any; recordDispatched: any } {
  return {
    ownerId: "owner-1",
    requestRuns: vi.fn(async () => responses.shift() || { ok: false, statusCode: 503 }),
    recordDispatched: vi.fn(async () => ({ status: "recorded_stopping", run_status: "stopping" })),
    updateRun: vi.fn(async () => true),
    completeRun: vi.fn(async () => true),
    markLeaseLost: vi.fn(),
    clearEvents: vi.fn(),
    hasLeaseBeenLost: vi.fn(() => false),
    now: () => now,
  };
}

describe("stopping run recovery", () => {
  it("cancels locally when dispatch never started", async () => {
    const dependencies = harness();
    await recoverStoppingRun(run({ upstream_run_id: null, dispatch_attempts: 0 }), dependencies);
    expect(dependencies.completeRun).toHaveBeenCalledWith("run-1", "cancelled", "", "CANCELLED_BY_USER");
    expect(dependencies.requestRuns).not.toHaveBeenCalled();
  });

  it("recovers an unknown upstream id before attempting cancellation", async () => {
    const dependencies = harness([{ ok: true, statusCode: 200, json: { runs: [{ id: "run-1" }] } }]);
    await recoverStoppingRun(run({ upstream_run_id: null }), dependencies);
    expect(dependencies.recordDispatched).toHaveBeenCalledWith(expect.objectContaining({ upstreamRunId: "run-1" }));
    expect(dependencies.completeRun).not.toHaveBeenCalled();
  });

  it("converges an upstream completion instead of overwriting it with cancellation", async () => {
    const dependencies = harness([{ ok: true, statusCode: 200, json: { status: "completed", output: "finished" } }]);
    const target = run();
    await recoverStoppingRun(target, dependencies);
    expect(dependencies.completeRun).toHaveBeenCalledWith(
      "run-1", "completed", "finished", undefined, {}, 0,
      { expectedUpstreamRunId: "upstream-1", runSnapshot: target },
    );
    expect(dependencies.updateRun).not.toHaveBeenCalled();
  });

  it("records the retry before sending a stop request", async () => {
    const order: string[] = [];
    const dependencies = harness([
      { ok: true, statusCode: 200, json: { status: "running" } },
      { ok: true, statusCode: 202, json: { status: "stopping" } },
    ]);
    dependencies.updateRun.mockImplementation(async () => { order.push("record"); return true; });
    dependencies.requestRuns.mockImplementation(async () => {
      order.push(order.length === 0 ? "probe" : "stop");
      return order.length === 1
        ? { ok: true, statusCode: 200, json: { status: "running" } }
        : { ok: true, statusCode: 202, json: { status: "stopping" } };
    });
    await recoverStoppingRun(run(), dependencies);
    expect(order).toEqual(["probe", "record", "stop"]);
  });

  it("does not contact the runtime after losing the lease while recording an attempt", async () => {
    const dependencies = harness([{ ok: true, statusCode: 200, json: { status: "running" } }]);
    dependencies.updateRun.mockResolvedValue(false);
    await recoverStoppingRun(run(), dependencies);
    expect(dependencies.markLeaseLost).toHaveBeenCalledWith("run-1");
    expect(dependencies.requestRuns).toHaveBeenCalledTimes(1);
  });

  it("fails closed when whole-run cancellation is unsupported", async () => {
    const dependencies = harness([{ ok: true, statusCode: 200, json: { status: "running" } }]);
    dependencies.capabilities = {
      ...HERMES_RUNTIME_CAPABILITIES,
      cancellation: { supported: true, granularity: "turn" },
    };
    await recoverStoppingRun(run(), dependencies);
    expect(dependencies.completeRun).toHaveBeenCalledWith(
      "run-1", "failed", "", "RUNTIME_RUN_CANCELLATION_UNSUPPORTED",
    );
    expect(dependencies.updateRun).not.toHaveBeenCalled();
  });
});
