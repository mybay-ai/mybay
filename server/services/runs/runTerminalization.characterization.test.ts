import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../../repositories/chatRepo";
import {
  RECONCILER_ID,
  clearEventsCache,
  completeRun,
  getEventsFromCache,
} from "../runsReconciler";

describe("run terminalization characterization", () => {
  const runId = "terminal-run-1";

  afterEach(() => {
    clearEventsCache(runId);
    vi.restoreAllMocks();
  });

  it("persists a completed run before publishing final events", async () => {
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockImplementation(async () => {
      expect(getEventsFromCache(runId, 0).events).toEqual([]);
      return { status: "success", assistant_message_id: "assistant-1", assistant_sequence_no: 2 };
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);

    await expect(completeRun(runId, "completed", "done", undefined, {
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
    }, 41)).resolves.toBe(true);

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      status: "completed",
      assistantContent: "done",
      errorCode: undefined,
      usagePromptTokens: 2,
      usageCompletionTokens: 3,
      usageTotalTokens: 5,
      durationMs: 41,
      reconcilerId: RECONCILER_ID,
      expectedUpstreamRunId: undefined,
    }));
    const events = getEventsFromCache(runId, 0).events;
    expect(events.map((event) => event.event)).toEqual(["step", "status"]);
    expect(JSON.parse(events[1].data)).toEqual({ status: "completed", errorCode: null, durationMs: 41 });
  });

  it("does not publish terminal events when persistence loses the lease", async () => {
    vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "lease_lost",
      assistant_message_id: null,
      assistant_sequence_no: null,
    });

    await expect(completeRun(runId, "failed", "", "UPSTREAM_FAILED")).resolves.toBe(false);
    expect(getEventsFromCache(runId, 0).events).toEqual([]);
  });

  it("replays the database terminal state when persistence reports already_terminal", async () => {
    vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "already_terminal",
      assistant_message_id: null,
      assistant_sequence_no: null,
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue({
      status: "failed",
      error_code: "UPSTREAM_FAILED",
      duration_ms: 19,
    });

    await expect(completeRun(runId, "completed", "stale answer")).resolves.toBe(true);
    const events = getEventsFromCache(runId, 0).events;
    expect(JSON.parse(events[0].data)).toEqual(expect.objectContaining({ status: "failed" }));
    expect(JSON.parse(events[1].data)).toEqual({
      status: "failed",
      errorCode: "UPSTREAM_FAILED",
      durationMs: 19,
    });
  });

  it("authorizes upstream terminal events by upstream identity instead of lease owner", async () => {
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);

    await expect(completeRun(runId, "cancelled", "", "CANCELLED_UPSTREAM", undefined, null, {
      expectedUpstreamRunId: "upstream-1",
    })).resolves.toBe(true);

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "cancelled",
      reconcilerId: undefined,
      expectedUpstreamRunId: "upstream-1",
    }));
  });

  it("turns leaked DSML tool-call protocol into a sanitized failed terminal result", async () => {
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "failure_recorded",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(completeRun(runId, "completed", "<DSML tool_calls>hidden</DSML>")).resolves.toBe(true);

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      assistantContent: "",
      errorCode: "UPSTREAM_FAILED",
    }));
  });
});
