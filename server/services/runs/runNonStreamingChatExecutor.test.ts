import { describe, expect, it, vi } from "vitest";
import {
  createRunNonStreamingChatExecutor,
  filterCurrentRunMessageFromHistory
} from "./runNonStreamingChatExecutor";

function createHarness(result: Record<string, unknown>) {
  const requestRuns = vi.fn(async () => result as never);
  const emitStatus = vi.fn();
  const completeRun = vi.fn(async () => true);
  const logOperation = vi.fn();
  const times = [1_000, 1_125];
  const execute = createRunNonStreamingChatExecutor({
    requestRuns,
    emitStatus,
    toReasoningModelOptions: (value) => ({ effort: value }),
    completeRun,
    logOperation,
    now: () => times.shift() ?? 1_125
  });
  return { execute, requestRuns, emitStatus, completeRun, logOperation };
}

const run = { id: "run-1", instance_id: "instance-1", reasoning_effort: "deep" };
const messages = [
  { id: "old", role: "assistant", content: "old answer" },
  { id: "current", role: "user", content: "duplicate by id" },
  { request_id: "request-current", role: "user", content: "duplicate by request" },
  { role: "user", content: "question" }
];

describe("runNonStreamingChatExecutor", () => {
  it("filters the current run message by both message and request identity", () => {
    expect(filterCurrentRunMessageFromHistory(messages, "current", "request-current"))
      .toEqual([messages[0], messages[3]]);
  });

  it("emits mode status, sends the filtered request, and completes successful output", async () => {
    const usage = { input_tokens: 2, output_tokens: 3 };
    const harness = createHarness({
      ok: true,
      statusCode: 200,
      json: { choices: [{ message: { content: "final answer" } }], usage }
    });

    await expect(harness.execute(
      run,
      messages,
      "session-1",
      "provider_compatibility",
      "current",
      "request-current"
    )).resolves.toBe(true);

    expect(harness.emitStatus).toHaveBeenCalledWith("run-1", {
      status: "running",
      mode: "non_streaming_chat",
      reason: "provider_compatibility"
    });
    expect(harness.requestRuns).toHaveBeenCalledWith({
      instanceId: "instance-1",
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        messages: [
          { role: "assistant", content: "old answer" },
          { role: "user", content: "question" }
        ],
        model: "hermes-agent",
        stream: false,
        model_options: { effort: "deep" }
      },
      hermesSessionId: "session-1",
      timeoutMs: 120000
    });
    expect(harness.completeRun).toHaveBeenCalledWith(
      "run-1",
      "completed",
      "final answer",
      undefined,
      usage,
      125
    );
  });

  it("normalizes transport failures before terminal completion", async () => {
    const harness = createHarness({ ok: false, statusCode: 503, error: "unavailable" });

    await expect(harness.execute(run, messages, "session-1", "fallback")).resolves.toBe(false);
    expect(harness.completeRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "",
      "DISPATCH_UPSTREAM_UNAVAILABLE",
      undefined,
      125
    );
  });

  it("rejects a successful response without assistant content", async () => {
    const usage = { input_tokens: 2 };
    const harness = createHarness({ ok: true, statusCode: 200, json: { choices: [], usage } });

    await expect(harness.execute(run, messages, "session-1", "fallback")).resolves.toBe(false);
    expect(harness.completeRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "",
      "UPSTREAM_FAILED",
      usage,
      125
    );
  });

  it("blocks leaked DSML tool-call protocol text", async () => {
    const usage = { output_tokens: 4 };
    const harness = createHarness({
      ok: true,
      statusCode: 200,
      json: { content: "<DSML tool_calls invoke>", usage }
    });

    await expect(harness.execute(run, messages, "session-1", "fallback")).resolves.toBe(false);
    expect(harness.completeRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "",
      "TOOL_CALL_PROTOCOL_LEAK",
      usage,
      125
    );
  });
});
