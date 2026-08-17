import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: vi.fn(() => ({ ok: true, apiKey: "internal-key" })),
}));
vi.mock("../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: vi.fn(),
}));

import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { requestTraefikInternal } from "../../utils/traefikInternalRequest";
import { RECONCILER_ID, clearEventsCache, processSingleRun } from "../runsReconciler";

function stoppingRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "recovery-run-1",
    status: "stopping",
    upstream_run_id: null,
    dispatch_attempts: 1,
    stop_attempts: 0,
    stop_requested_at: "2026-08-17T00:00:00.000Z",
    instance_id: "instance-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    last_event_seq: 0,
    partial_output: "",
    ...overrides,
  };
}

describe("stopping upstream recovery characterization", () => {
  afterEach(() => {
    clearEventsCache("recovery-run-1");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recovers an upstream id from the wrapped runs list before retrying stop recovery", async () => {
    vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({ config_json: {} } as never);
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { runs: [{ id: "upstream-recovered", run_id: "recovery-run-1" }] },
    } as never);
    const record = vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "recorded_stopping",
      run_status: "stopping",
    });
    const update = vi.spyOn(chatRepo, "updateChatRun");

    await processSingleRun(stoppingRun(), new Set());

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      runId: "recovery-run-1",
      reconcilerId: RECONCILER_ID,
      upstreamRunId: "upstream-recovered",
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it("increments finite recovery attempts when no upstream match is found", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:01:00.000Z"));
    vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({ config_json: {} } as never);
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { data: [] },
    } as never);
    const update = vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);

    await processSingleRun(stoppingRun(), new Set());

    expect(update).toHaveBeenCalledWith("recovery-run-1", {
      stop_attempts: 1,
      stop_requested_at: "2026-08-17T00:00:00.000Z",
    }, RECONCILER_ID);
    vi.useRealTimers();
  });

  it("fails recovery after the third attempt without issuing another state update", async () => {
    vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({ config_json: {} } as never);
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: [],
    } as never);
    const update = vi.spyOn(chatRepo, "updateChatRun");
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);

    await processSingleRun(stoppingRun({ stop_attempts: 3 }), new Set());

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "STOP_CONFIRMATION_TIMEOUT",
    }));
    expect(update.mock.calls.some(([, patch]) => Object.prototype.hasOwnProperty.call(patch, "stop_attempts"))).toBe(false);
  });
});
