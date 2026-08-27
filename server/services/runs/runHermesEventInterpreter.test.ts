import { describe, expect, it, vi } from "vitest";
import { createRunHermesEventInterpreter } from "./runHermesEventInterpreter";

function createHarness(completeTerminal = vi.fn(async () => true)) {
  const events: Array<{ runId: string; event: string; data: string; ownerId?: string }> = [];
  const requestReconcile = vi.fn();
  const warn = vi.fn();
  let uuidSequence = 0;
  const interpreter = createRunHermesEventInterpreter({
    addEvent: (runId, event, data, ownerId) => events.push({ runId, event, data, ownerId }),
    completeTerminal,
    requestReconcile,
    warn,
    randomUUID: () => `uuid-${++uuidSequence}`,
    now: () => 1_700_000_000_000
  });
  return { interpreter, events, completeTerminal, requestReconcile, warn };
}

describe("runHermesEventInterpreter", () => {
  it("owns tracker creation and cleanup without replacing an existing tracker", () => {
    const { interpreter } = createHarness();
    const tracker = interpreter.getOrCreate("run-1", "initial");

    expect(interpreter.getOrCreate("run-1", "replacement")).toBe(tracker);
    expect(tracker.lastPartialOutput).toBe("initial");

    interpreter.clear("run-1");
    expect(interpreter.get("run-1")).toBeUndefined();
  });

  it("creates a safe step id for an unmatched tool completion", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle({ id: "run-1" }, { event: "tool.completed", tool: "search" });

    const step = JSON.parse(events[0].data);
    expect(step.id).toBe("step-uuid-1");
    expect(step.status).toBe("completed");
  });

  it("defaults invalid approval identifiers and choices", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle(
      { id: "run-1" },
      { event: "approval.request", approval_id: "invalid id", choices: ["invalid"] }
    );

    const approval = JSON.parse(events[0].data);
    expect(approval).toMatchObject({
      id: "approval-uuid-1",
      status: "pending",
      choices: ["once", "deny"],
      timestamp: 1_700_000_000
    });
    expect(JSON.parse(events[1].data)).toEqual({ status: "waiting_for_approval" });
  });

  it("tracks approval interaction state for status-probe deduplication", () => {
    const { interpreter } = createHarness();
    interpreter.handle({ id: "run-1" }, { event: "approval.request", approval_id: "approval-1" });
    expect(interpreter.get("run-1")?.sentSteps.get("interaction:approval:approval-1")).toBe("pending");
    interpreter.handle({ id: "run-1" }, { event: "approval.responded", approval_id: "approval-1", choice: "once" });
    expect(interpreter.get("run-1")?.sentSteps.get("interaction:approval:approval-1")).toBe("resolved");
  });

  it("requests reconciliation when immediate terminal handling rejects", async () => {
    const terminalError = new Error("terminal write failed");
    const { interpreter, completeTerminal, requestReconcile, warn } = createHarness(
      vi.fn(async () => { throw terminalError; })
    );

    interpreter.handle({ id: "run-1" }, { event: "run.failed", run_id: "upstream-1" });
    await vi.waitFor(() => expect(requestReconcile).toHaveBeenCalledOnce());

    expect(completeTerminal).toHaveBeenCalledWith(
      { id: "run-1" },
      { event: "run.failed", run_id: "upstream-1" },
      "upstream-1"
    );
    expect(warn).toHaveBeenCalledWith(
      "[RunsReconciler] Immediate terminal handling failed for run run-1:",
      "terminal write failed"
    );
  });
});
