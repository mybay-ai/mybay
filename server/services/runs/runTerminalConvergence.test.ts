import { describe, expect, it, vi } from "vitest";
import { convergeRunTerminalProbe } from "./runTerminalConvergence";

const run = { id: "run-1", instance_id: "instance-1", upstream_run_id: "upstream-1", status: "running" };

describe("run terminal convergence", () => {
  it("leaves non-terminal observations open", async () => {
    const completeRun = vi.fn();
    await expect(convergeRunTerminalProbe(run, null, "status_probe", { completeRun }))
      .resolves.toEqual({ terminal: false, committed: false });
    expect(completeRun).not.toHaveBeenCalled();
  });

  it("binds successful completion to the exact upstream run", async () => {
    const completeRun = vi.fn(async () => true);
    await expect(convergeRunTerminalProbe(run, {
      status: "completed",
      assistantContent: "done",
      usage: { total_tokens: 2 },
      durationMs: 12,
    }, "status_probe", { completeRun })).resolves.toEqual({ terminal: true, committed: true, status: "completed" });
    expect(completeRun).toHaveBeenCalledWith(
      "run-1", "completed", "done", undefined, { total_tokens: 2 }, 12,
      { expectedUpstreamRunId: "upstream-1", runSnapshot: run },
    );
  });

  it("converges failed and cancelled observations", async () => {
    const completeRun = vi.fn(async () => true);
    await convergeRunTerminalProbe(run, { status: "failed", error: "UPSTREAM_FAILED" }, "stop_recovery", { completeRun });
    await convergeRunTerminalProbe(run, { status: "cancelled", errorCode: "CANCELLED_UPSTREAM" }, "stop_recovery", { completeRun });
    expect(completeRun).toHaveBeenNthCalledWith(1, "run-1", "failed", "", "UPSTREAM_FAILED");
    expect(completeRun).toHaveBeenNthCalledWith(2, "run-1", "cancelled", "", "CANCELLED_UPSTREAM");
  });

  it("reports a deferred atomic commit without changing the observed terminal state", async () => {
    await expect(convergeRunTerminalProbe(run, { status: "cancelled", errorCode: "CANCELLED_UPSTREAM" }, "status_probe", {
      completeRun: vi.fn(async () => false),
    })).resolves.toEqual({ terminal: true, committed: false, status: "cancelled" });
  });
});
