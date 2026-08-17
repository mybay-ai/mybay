import { describe, expect, it } from "vitest";
import { createRunExecutionState, deriveAssistantText } from "./runReducer";
import { consumeRunSseFrame } from "./runStreamCoordinator";

function initial(text = "") {
  return createRunExecutionState({
    runId: "run-1",
    conversationId: "conv-1",
    status: "running",
    initialText: text
  });
}

describe("consumeRunSseFrame", () => {
  it("resumes after reconnect without duplicating the last committed frame", () => {
    const first = consumeRunSseFrame(initial(), { currentEventId: 0, lastCommittedEventId: 0 }, {
      eventId: 1,
      event: "text",
      data: "hello",
      runId: "run-1",
      conversationId: "conv-1"
    });
    const replay = consumeRunSseFrame(first.state, first.cursor, {
      eventId: 1,
      event: "text",
      data: "hello",
      runId: "run-1",
      conversationId: "conv-1"
    });
    const resumed = consumeRunSseFrame(replay.state, replay.cursor, {
      eventId: 2,
      event: "text",
      data: " world",
      runId: "run-1",
      conversationId: "conv-1"
    });

    expect(replay.consumed).toBe(false);
    expect(replay.cursor.lastCommittedEventId).toBe(1);
    expect(deriveAssistantText(resumed.state.blocks)).toBe("hello world");
    expect(resumed.cursor.lastCommittedEventId).toBe(2);
  });

  it("does not commit an event bound to another conversation", () => {
    const result = consumeRunSseFrame(initial(), { currentEventId: 0, lastCommittedEventId: 3 }, {
      eventId: 4,
      event: "text",
      data: "leak",
      runId: "run-1",
      conversationId: "conv-2"
    });
    expect(result.consumed).toBe(false);
    expect(result.cursor.lastCommittedEventId).toBe(3);
    expect(deriveAssistantText(result.state.blocks)).toBe("");
  });

  it("ignores late frames after stop and keeps the terminal cursor", () => {
    const stopped = consumeRunSseFrame(initial("partial"), { currentEventId: 0, lastCommittedEventId: 4 }, {
      eventId: 5,
      event: "status",
      data: JSON.stringify({ status: "stopped" }),
      runId: "run-1",
      conversationId: "conv-1"
    });
    const late = consumeRunSseFrame(stopped.state, stopped.cursor, {
      eventId: 6,
      event: "text",
      data: " late",
      runId: "run-1",
      conversationId: "conv-1"
    });

    expect(stopped.state.status).toBe("stopped");
    expect(late.consumed).toBe(false);
    expect(late.cursor.lastCommittedEventId).toBe(5);
    expect(deriveAssistantText(late.state.blocks)).toBe("partial");
  });

  it("continues from recovered partial output for id-less local frames", () => {
    const recovered = initial("saved");
    const next = consumeRunSseFrame(recovered, { currentEventId: 0, lastCommittedEventId: 8 }, {
      event: "text",
      data: " locally",
      runId: "run-1",
      conversationId: "conv-1"
    });

    expect(next.consumed).toBe(true);
    expect(next.state.lastProcessedSeq).toBe(9);
    expect(next.cursor.lastCommittedEventId).toBe(8);
    expect(deriveAssistantText(next.state.blocks)).toBe("saved locally");
  });

  it("rejects malformed frames without losing the reconnect cursor", () => {
    const result = consumeRunSseFrame(initial(), { currentEventId: 0, lastCommittedEventId: 10 }, {
      eventId: 11,
      event: "step",
      data: "{bad",
      runId: "run-1",
      conversationId: "conv-1"
    });

    expect(result.consumed).toBe(false);
    expect(result.cursor.lastCommittedEventId).toBe(10);
  });
});
