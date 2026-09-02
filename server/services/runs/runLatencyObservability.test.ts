import { describe, expect, it } from "vitest";
import { createRunLatencyObservability } from "./runLatencyObservability";

describe("run latency observability", () => {
  it("records each lifecycle boundary once and emits no content", () => {
    let current = 1_100;
    const tracker = createRunLatencyObservability(() => current);
    tracker.markFirstUpstreamByte("run-1");
    current = 1_120;
    tracker.observeRuntimeEvent("run-1", { event: "run.started", private: "SECRET" });
    current = 1_300;
    tracker.observeRuntimeEvent("run-1", { event: "message.delta", delta: "PRIVATE_TEXT" });
    current = 1_500;
    tracker.observeRuntimeEvent("run-1", { event: "tool.started", arguments: "PRIVATE_ARGS" });
    current = 1_900;
    tracker.observeRuntimeEvent("run-1", { event: "tool.completed", result: "PRIVATE_RESULT" });
    current = 2_000;
    tracker.observeRuntimeEvent("run-1", { event: "run.completed" });
    current = 2_080;

    const result = tracker.finish("run-1", {
      created_at: new Date(0).toISOString(),
      started_at: new Date(1_000).toISOString(),
    }, "completed");

    expect(result).toEqual({
      version: 1,
      finalStatus: "completed",
      queueMs: 1_000,
      dispatchToFirstUpstreamByteMs: 100,
      dispatchToFirstRuntimeEventMs: 120,
      dispatchToFirstVisibleTextMs: 300,
      dispatchToFirstToolMs: 500,
      toolSpanMs: 400,
      upstreamTerminalToPersistedMs: 80,
      runtimeMs: 1_080,
      totalMs: 2_080,
    });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
  });

  it("reports unavailable phases as null without inventing timings", () => {
    let current = 500;
    const tracker = createRunLatencyObservability(() => current);
    tracker.observeRuntimeEvent("run-2", { event: "run.completed" });
    current = 550;
    expect(tracker.finish("run-2", { created_at: "invalid", started_at: null }, "completed"))
      .toMatchObject({
        queueMs: null,
        dispatchToFirstUpstreamByteMs: null,
        dispatchToFirstVisibleTextMs: null,
        dispatchToFirstToolMs: null,
        toolSpanMs: null,
        upstreamTerminalToPersistedMs: 50,
        runtimeMs: null,
        totalMs: null,
      });
  });
});
