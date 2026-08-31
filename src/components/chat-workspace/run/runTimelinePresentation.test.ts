import { describe, expect, it } from "vitest";
import { createLocalRunTimeline } from "../../../../shared/localRunTimeline";
import { createRunExecutionState, reduceRunEvents } from "./runReducer";
import { projectRunTimeline, restoreMessageTimeline, selectMessageTimeline } from "./runTimelinePresentation";
import { resolveToolDisplayStatus } from "./runStatusSemantics";
import { findRunAssistantMessageIndex } from "./runSelectors";

const events = [
  { seq: 1, type: "text.delta" as const, payload: { delta: "Before." }, runId: "r", conversationId: "c" },
  { seq: 2, type: "tool.started" as const, payload: { id: "t", tool: "file" }, runId: "r", conversationId: "c" },
  { seq: 3, type: "tool.completed" as const, payload: { id: "t", tool: "file" }, runId: "r", conversationId: "c" },
  { seq: 4, type: "text.delta" as const, payload: { delta: "Final." }, runId: "r", conversationId: "c" },
];
const execution = () => reduceRunEvents(createRunExecutionState({ runId: "r", conversationId: "c" }), events);
describe("timeline presentation and restoration", () => {
  it("merges the optimistic queue step with its server event and excludes lifecycle markers from tool counts", () => {
    const state = createRunExecutionState({ runId: "r", conversationId: "c", initialStep: { id: "r-task_queued", tool: "agent", stepType: "model_reasoning" } });
    const replay = reduceRunEvents(state, [{ seq: 1, runId: "r", type: "tool.started", payload: { id: "r-task_queued", tool: "other", stepType: "model_reasoning" } }]);
    expect(replay.blocks).toHaveLength(1);
    expect(projectRunTimeline(replay, "").blocks).toHaveLength(0);
  });
  it("interleaves narration and tools while showing the final reply exactly once", () => {
    const projection = projectRunTimeline(execution(), "Before.Final.");
    expect(projection.blocks.map(b => b.type)).toEqual(["text", "tool"]);
    expect(projection.finalContent).toBe("Final.");
    expect(projectRunTimeline(execution(), "Final.")).toEqual(projection);
    expect(projectRunTimeline(execution(), "Authoritative replacement.")).toMatchObject({ finalContent: "Authoritative replacement.", textUnaligned: true });
    expect(projectRunTimeline(execution(), "Authoritative replacement.").blocks.every(b => b.type !== "text")).toBe(true);
  });
  it("replayed events do not duplicate blocks and foreign events are ignored", () => {
    const replay = reduceRunEvents(execution(), [...events, { ...events[3], seq: 100, runId: "other" }]);
    expect(replay).toEqual(execution());
  });
  it("does not split final text around background lifecycle observations", () => {
    const state = reduceRunEvents(execution(), [
      { seq: 5, runId: "r", type: "tool.completed", payload: { id: "lease", tool: "other", stepType: "model_reasoning" } },
      { seq: 6, runId: "r", type: "text.delta", payload: { delta: " Continued." } },
    ]);
    expect(projectRunTimeline(state, "Final. Continued.")).toMatchObject({ finalContent: "Final. Continued.", textUnaligned: false });
  });
  it("restores only the matching assistant after reload and preserves unconfirmed outcomes", () => {
    const snapshot = createLocalRunTimeline({ runId: "r", conversationId: "c", status: "completed", events: [
      { id: 1, event: "step", data: '{"id":"t","tool_name":"file","status":"running"}' },
      { id: 2, event: "text", data: "Final." },
    ] });
    const message = { id: "m", role: "assistant" as const, content: "Final.", conversation_id: "c", metadata: { run_id: "r", run_timeline: snapshot } };
    const restored = restoreMessageTimeline(message, "c")!;
    expect(restored.status).toBe("completed");
    const tool = restored.blocks.find(b => b.type === "tool")!;
    expect(tool.type === "tool" && resolveToolDisplayStatus(tool.status, "completed", tool.completionInferred)).toBe("unknown");
    expect(restoreMessageTimeline(message, "other")).toBeNull();
    expect(restoreMessageTimeline({ ...message, metadata: { ...message.metadata, run_id: "foreign" } }, "c")).toBeNull();
    expect(selectMessageTimeline(message, "c", createRunExecutionState({ runId: "next", conversationId: "c" }))?.runId).toBe("r");
    expect(findRunAssistantMessageIndex([message], createRunExecutionState({ runId: "r", conversationId: "c" }))).toBe(0);
    expect(findRunAssistantMessageIndex([message], createRunExecutionState({ runId: "r", conversationId: "other" }))).toBe(-1);
  });
  it("distinguishes stop, explicit failure and unknown completion", () => {
    expect(resolveToolDisplayStatus("failed", "stopped", true)).toBe("stopped");
    expect(resolveToolDisplayStatus("failed", "failed", true)).toBe("unknown");
    expect(resolveToolDisplayStatus("failed", "failed", false)).toBe("failed");
    expect(resolveToolDisplayStatus("failed", "stopped", false)).toBe("failed");
    expect(resolveToolDisplayStatus("completed", "completed", false)).toBe("completed");
  });
  it("does not hide the only reply inside a collapsed terminal process", () => {
    const state = reduceRunEvents(createRunExecutionState({ runId: "r", conversationId: "c" }), events.slice(0, 2));
    expect(projectRunTimeline({ ...state, status: "cancelled" }, "Before.").finalContent).toBe("Before.");
    expect(findRunAssistantMessageIndex([{ id: "m", role: "assistant", content: "", conversation_id: "foreign", request_id: "req" }],
      createRunExecutionState({ runId: "r", conversationId: "c", assistantMessageId: "m", requestId: "req" }))).toBe(-1);
  });
});
