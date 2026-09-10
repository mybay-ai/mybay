import { describe, expect, it, vi } from "vitest";
import { hermesRunEventProvider } from "../adapters/hermes/HermesRunEvents";
import { piRuntimeDriver } from "../adapters/pi/PiRuntimeDriver";
import { codexRuntimeDriver } from "../adapters/codex/CodexRuntimeDriver";
import type { RuntimeRunEventProvider } from "../contracts";
import { normalizedRunEventProvider } from "./NormalizedRunEvents";

function createProviderHarness(provider: RuntimeRunEventProvider, completeTerminal = vi.fn(async () => true)) {
  const events: Array<{ runId: string; event: string; data: string; ownerId?: string }> = [];
  const requestReconcile = vi.fn();
  const warn = vi.fn();
  let uuidSequence = 0;
  const interpreter = provider.createController({
    addEvent: (runId, event, data, ownerId) => events.push({ runId, event, data, ownerId }),
    completeTerminal,
    requestReconcile,
    warn,
    randomUUID: () => `uuid-${++uuidSequence}`,
    now: () => 1_700_000_000_000,
  });
  return { interpreter, events, completeTerminal, requestReconcile, warn };
}

describe.each([
  { name: "Normalized", provider: normalizedRunEventProvider, reconcileDecoder: false },
  { name: "Hermes", provider: hermesRunEventProvider, reconcileDecoder: true },
  { name: "Pi", provider: piRuntimeDriver.events, reconcileDecoder: false },
  { name: "Codex", provider: codexRuntimeDriver.events, reconcileDecoder: false },
])("$name run events", ({ provider, reconcileDecoder }) => {
  const createHarness = (completeTerminal?: ReturnType<typeof vi.fn<() => Promise<boolean>>>) =>
    createProviderHarness(provider, completeTerminal);

  it("rejects foreign text, approval and terminal events on a bound run", async () => {
    const { interpreter, events, completeTerminal } = createHarness();
    const run = { id: "local-1", upstream_run_id: "native-1" };
    for (const event of [
      { type: "message.delta", delta: "foreign output" },
      { type: "approval.request", approval_id: "foreign-approval" },
      { type: "run.completed", output: "foreign result" },
    ]) interpreter.handle(run, { ...event, run_id: "native-other" }, "native-1");
    expect(events).toEqual([]);
    expect(interpreter.get(run.id)).toBeUndefined();
    await expect(interpreter.completeTerminalEvent(run, { type: "run.cancelled", run_id: "native-other" }, "native-1")).resolves.toBe(false);
    expect(completeTerminal).not.toHaveBeenCalled();
    interpreter.handle(run, { type: "message.delta", run_id: "native-1", delta: "correct" }, "native-1");
    expect(interpreter.get(run.id)?.lastPartialOutput).toBe("correct");
  });

  it("scopes decoder recovery to the adapter before output", async () => {
    const { interpreter, requestReconcile, completeTerminal } = createHarness();
    const run = { id: "run-1" };
    await expect(interpreter.completeTerminalEvent(run, {
      event: "run.failed", error: "STREAMING_DECODER_ERROR",
    }, "upstream-1")).resolves.toBe(!reconcileDecoder);
    expect(requestReconcile).toHaveBeenCalledTimes(reconcileDecoder ? 1 : 0);
    if (reconcileDecoder) expect(completeTerminal).not.toHaveBeenCalled();
    else expect(completeTerminal).toHaveBeenCalledWith(run,
      expect.objectContaining({ status: "failed", errorCode: "STREAMING_DECODER_ERROR" }), "upstream-1");
  });

  it("commits a failed terminal after partial output instead of silently recovering", async () => {
    const { interpreter, requestReconcile, completeTerminal } = createHarness();
    const run = { id: "run-1" };
    interpreter.handle(run, { event: "message.delta", delta: "partial" });
    await interpreter.completeTerminalEvent(run, { event: "run.failed", error: "STREAMING_DECODER_ERROR" }, "upstream-1");
    expect(completeTerminal).toHaveBeenCalledWith(run, expect.objectContaining({ status: "failed" }), "upstream-1");
    expect(requestReconcile).not.toHaveBeenCalled();
  });

  it("publishes unstreamed interim assistant messages separately from final output", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle({ id: "run-1" }, {
      event: "message.interim",
      id: "native:interim:1",
      text: "I inspected the project structure.",
      timestamp: 1_700_000_001,
      already_streamed: false,
    });
    expect(events).toEqual([{
      runId: "run-1",
      event: "commentary",
      data: JSON.stringify({ id: "native:interim:1", text: "I inspected the project structure.", timestamp: 1_700_000_001 }),
      ownerId: undefined,
    }]);
    expect(interpreter.get("run-1")?.lastPartialOutput).toBe("");
  });

  it("does not duplicate interim commentary already delivered as text", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle({ id: "run-1" }, {
      event: "message.interim",
      text: "already visible",
      already_streamed: true,
    });
    expect(events).toEqual([]);
  });

  it("keeps simultaneous runs and controller instances isolated", () => {
    const first = createHarness();
    const second = createHarness();
    first.interpreter.handle({ id: "a" }, { event: "message.delta", delta: "one" });
    first.interpreter.handle({ id: "b" }, { event: "message.delta", delta: "two" });
    first.interpreter.handle({ id: "a" }, { event: "approval.request", approval_id: "same-id" });
    second.interpreter.handle({ id: "a" }, { event: "message.delta", delta: "other controller" });
    expect(first.interpreter.get("b")?.lastPartialOutput).toBe("two");
    expect(first.interpreter.get("b")?.sentSteps.has("interaction:approval:same-id")).toBe(false);
    first.interpreter.clear("a");
    expect(first.interpreter.get("b")?.lastPartialOutput).toBe("two");
    expect(second.interpreter.get("a")?.lastPartialOutput).toBe("other controller");
  });

  it("preserves cancellation and reported usage without turning it into success", async () => {
    const { interpreter, completeTerminal } = createHarness();
    const run = { id: "cancel-run" };
    await interpreter.completeTerminalEvent(run, {
      event: "run.cancelled", model: "reported-model", usage: { input_tokens: 5, output_tokens: 2 }, duration_ms: 30,
    }, "cancel-upstream");
    expect(completeTerminal).toHaveBeenCalledWith(run, expect.objectContaining({
      status: "cancelled", errorCode: "CANCELLED_UPSTREAM", durationMs: 30,
      usage: expect.objectContaining({ input_tokens: 5, output_tokens: 2, model: "reported-model" }),
    }), "cancel-upstream");
  });
  it("owns tracker creation and cleanup without replacing an existing tracker", () => {
    const { interpreter } = createHarness();
    const tracker = interpreter.getOrCreate("run-1", "initial");
    expect(interpreter.getOrCreate("run-1", "replacement")).toBe(tracker);
    expect(tracker.lastPartialOutput).toBe("initial");
    interpreter.clear("run-1");
    expect(interpreter.get("run-1")).toBeUndefined();
  });

  it("normalizes terminal completion before committing it", async () => {
    const { interpreter, completeTerminal } = createHarness();
    const run = { id: "run-1", partial_output: "fallback" };
    interpreter.getOrCreate(run.id, run.partial_output);

    await expect(interpreter.completeTerminalEvent(
      run,
      { event: "run.completed", duration_ms: 42 },
      "upstream-1",
    )).resolves.toBe(true);
    expect(completeTerminal).toHaveBeenCalledWith(run, {
      status: "completed",
      assistantContent: "fallback",
      usage: undefined,
      durationMs: 42,
    }, "upstream-1");
  });

  it("creates a safe step id for an unmatched tool completion", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle({ id: "run-1" }, { event: "tool.completed", tool: "search" });
    const step = JSON.parse(events[0].data);
    expect(step.id).toBe("step-uuid-1");
    expect(step.status).toBe("completed");
  });

  it("retains one stable step id from tool start through its terminal outcome", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle(
      { id: "run-1" },
      { event: "tool.started", tool: "write_file", path: "/opt/data/result.txt", timestamp: 1_700_000_000 },
    );
    interpreter.handle(
      { id: "run-1" },
      { event: "tool.completed", tool: "write_file", path: "/opt/data/result.txt", timestamp: 1_700_000_001 },
    );

    const [started, completed] = events.map((event) => JSON.parse(event.data));
    expect(started).toMatchObject({ id: "step-uuid-1", status: "running", tool_name: "file" });
    expect(completed).toMatchObject({
      id: "step-uuid-1",
      status: "completed",
      tool_name: "file",
      metadata: { file_path: "result.txt", file_evidence_confirmed: true },
    });
  });

  it("preserves a safe native tool call id and its file metadata", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle(
      { id: "run-1" },
      { event: "tool.started", tool: "write", tool_call_id: "pi-call-1", path: "/opt/data/workspace/report.txt", operation: "write" },
    );
    interpreter.handle(
      { id: "run-1" },
      { event: "tool.completed", tool: "write", tool_call_id: "pi-call-1", path: "/opt/data/workspace/report.txt", operation: "write" },
    );
    const [started, completed] = events.map((event) => JSON.parse(event.data));
    expect(started).toMatchObject({ id: "step-pi-call-1", status: "running", metadata: { file_path: "workspace/report.txt" } });
    expect(completed).toMatchObject({ id: "step-pi-call-1", status: "completed", metadata: { file_path: "workspace/report.txt", file_evidence_confirmed: true } });
  });

  it("defaults invalid approval identifiers and choices", () => {
    const { interpreter, events } = createHarness();
    interpreter.handle(
      { id: "run-1" },
      { event: "approval.request", approval_id: "invalid id", choices: ["invalid"] },
    );
    const approval = JSON.parse(events[0].data);
    expect(approval).toMatchObject({
      id: "approval-uuid-1",
      status: "pending",
      choices: ["once", "deny"],
      timestamp: 1_700_000_000,
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

  it("keeps waiting until every pending native approval has been answered", () => {
    const { interpreter, events } = createHarness();
    for (const id of ["approval-1", "approval-2"]) interpreter.handle({ id: "run-1" }, { event: "approval.request", approval_id: id });
    interpreter.handle({ id: "run-1" }, { event: "approval.responded", approval_id: "approval-1", choice: "once" });
    expect(JSON.parse(events.at(-1)!.data)).toEqual({ status: "waiting_for_approval" });
    interpreter.handle({ id: "run-1" }, { event: "approval.responded", approval_id: "approval-2", choice: "deny" });
    expect(JSON.parse(events.at(-1)!.data)).toEqual({ status: "running" });
  });

  it("requests reconciliation when immediate terminal handling rejects", async () => {
    const { interpreter, completeTerminal, requestReconcile, warn } = createHarness(
      vi.fn(async () => { throw new Error("terminal write failed"); }),
    );
    interpreter.handle({ id: "run-1" }, { event: "run.failed", run_id: "upstream-1" });
    await vi.waitFor(() => expect(requestReconcile).toHaveBeenCalledOnce());
    expect(completeTerminal).toHaveBeenCalledWith(
      { id: "run-1" },
      expect.objectContaining({ status: "failed", errorCode: "RUN_FAILED_UPSTREAM" }),
      "upstream-1",
    );
    expect(warn).toHaveBeenCalledWith(
      "[RunsReconciler] Immediate terminal handling failed for run run-1:",
      "terminal write failed",
    );
  });
});
