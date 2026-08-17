import { describe, expect, it } from "vitest";
import { normalizeSseRunEvent } from "./runEventNormalizer";

const base = { seq: 1, runId: "run-1", conversationId: "conv-1" };

describe("normalizeSseRunEvent", () => {
  it("normalizes text deltas without parsing their contents", () => {
    expect(normalizeSseRunEvent({ ...base, event: "text", data: "hello" })).toMatchObject({
      type: "text.delta",
      payload: { delta: "hello" }
    });
  });

  it("rejects malformed structured events", () => {
    expect(normalizeSseRunEvent({ ...base, event: "step", data: "{bad" })).toBeNull();
    expect(normalizeSseRunEvent({ ...base, event: "status", data: "{}" })).toBeNull();
  });

  it("normalizes legacy step fields", () => {
    expect(normalizeSseRunEvent({
      ...base,
      event: "step",
      data: JSON.stringify({ id: "tool-1", tool_name: "search", safe_summary: "Searching", status: "completed" })
    })).toMatchObject({
      type: "tool.completed",
      payload: { id: "tool-1", tool: "search", label: "Searching", stepType: "tool_call" }
    });
  });

  it("normalizes canceled status spelling", () => {
    expect(normalizeSseRunEvent({
      ...base,
      event: "status",
      data: JSON.stringify({ status: "canceled" })
    })).toMatchObject({ type: "status.changed", payload: { status: "cancelled" } });
  });
});
