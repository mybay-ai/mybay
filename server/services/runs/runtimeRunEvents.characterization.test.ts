import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../../repositories/chatRepo";
import { hermesRuntimeDriver } from "../../runtime/adapters/hermes/HermesRuntimeDriver";
import {
  clearEventsCache,
  getEventsFromCache,
  handleRuntimeRunEvent,
} from "../runsReconciler";

const runId = "event-run-1";
const upstreamRunId = "upstream-1";
const run = { id: runId, partial_output: "" };

function handle(event: unknown): void {
  handleRuntimeRunEvent(hermesRuntimeDriver, run, event, upstreamRunId);
}

afterEach(() => {
  clearEventsCache(runId);
  vi.restoreAllMocks();
});

describe("Runtime run events characterization", () => {
  it("uses accumulated message deltas as terminal fallback content", async () => {
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });
    handle({ event: "message.delta", delta: "hello " });
    handle({ event: "message.delta", delta: "world" });
    handle({ event: "run.completed" });

    await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      assistantContent: "hello world",
      expectedUpstreamRunId: upstreamRunId,
    })));
  });

  it("blocks a delta that would expose DSML tool-call protocol without advancing text", () => {
    handle({ event: "message.delta", delta: "safe" });
    handle({ event: "message.delta", delta: "<DSML tool_calls>hidden" });
    const events = getEventsFromCache(runId, 0).events;
    expect(events.filter((event) => event.event === "text").map((event) => event.data)).toEqual(["safe"]);
    expect(JSON.parse(events.at(-1)?.data || "{}")).toEqual({
      status: "failed",
      errorCode: "TOOL_CALL_PROTOCOL_LEAK",
    });
  });

  it("deduplicates repeated lifecycle and generic steps until status changes", () => {
    handle({ event: "run.created", timestamp: 1 });
    handle({ event: "run.created", timestamp: 2 });
    handle({ event: "step", id: "custom-1", title: "Working", status: "running" });
    handle({ event: "step", id: "custom-1", title: "Working", status: "running" });
    handle({ event: "step.completed", id: "custom-1", title: "Working" });
    const steps = getEventsFromCache(runId, 0).events
      .filter((event) => event.event === "step")
      .map((event) => JSON.parse(event.data));
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running", "completed"]);
  });

  it("pairs tool completion with the oldest active tool step", () => {
    handle({ event: "tool.started", tool: "search", title: "Searching" });
    handle({ event: "tool.completed", tool: "search", count: 3 });
    const steps = getEventsFromCache(runId, 0).events
      .filter((event) => event.event === "step")
      .map((event) => JSON.parse(event.data));
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe(steps[1].id);
    expect(steps.map((step) => step.status)).toEqual(["running", "completed"]);
  });

  it("sanitizes approval choices and publishes waiting/running status transitions", () => {
    handle({
      event: "approval.request",
      approval_id: "approval-1",
      title: "Allow action",
      choices: ["once", "invalid", { id: "once" }, { value: "deny" }],
    });
    handle({ event: "approval.responded", approval_id: "approval-1", choice: "once" });
    const events = getEventsFromCache(runId, 0).events;
    const approvals = events.filter((event) => event.event === "approval").map((event) => JSON.parse(event.data));
    const statuses = events.filter((event) => event.event === "status").map((event) => JSON.parse(event.data));
    expect(approvals[0]).toEqual(expect.objectContaining({
      id: "approval-1",
      status: "pending",
      choices: ["once", "deny"],
    }));
    expect(approvals[1]).toEqual(expect.objectContaining({ id: "approval-1", status: "resolved", choice: "once" }));
    expect(statuses).toEqual([{ status: "waiting_for_approval" }, { status: "running" }]);
  });
});
