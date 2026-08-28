import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: vi.fn(() => ({ ok: true, apiKey: "internal-key" })),
}));
vi.mock("../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: vi.fn(),
}));
vi.mock("../../utils/traefikInternalSse", () => ({
  streamTraefikInternalSse: vi.fn(async () => undefined),
}));
vi.mock("../instances/resourceAuthorityService", () => ({
  resolveRunDispatchAuthority: vi.fn(async (run: any) => ({
    ok: true, actor: { kind: "system", id: "test" }, ownerId: run.user_id,
    instance: { id: run.instance_id }, conversation: { id: run.conversation_id }, run,
  })),
}));

import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { requestTraefikInternal } from "../../utils/traefikInternalRequest";
import {
  RECONCILER_ID,
  clearEventsCache,
  getEventsFromCache,
  processSingleRun,
} from "../runsReconciler";

const runId = "probe-run-1";
const originalMaxRuntime = process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS;

function runningRun(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    status: "running",
    upstream_run_id: "upstream-1",
    instance_id: "instance-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    user_message_id: "message-1",
    created_at: new Date(Date.now() - 1_000).toISOString(),
    last_event_seq: 0,
    partial_output: "",
    runtime_type: "hermes",
    runtime_provider_key: "hermes-core",
    runtime_contract_version: 1,
    ...overrides,
  };
}

function stoppingRun(overrides: Record<string, unknown> = {}) {
  return {
    ...runningRun(),
    status: "stopping",
    stop_attempts: 0,
    stop_requested_at: new Date(Date.now() - 1_000).toISOString(),
    ...overrides,
  };
}

function prepareRepository() {
  vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({ config_json: {} } as never);
  vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
  vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
  return vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
    status: "success",
    assistant_message_id: "assistant-1",
    assistant_sequence_no: 2,
  });
}

afterEach(() => {
  clearEventsCache(runId);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (originalMaxRuntime === undefined) delete process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS;
  else process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS = originalMaxRuntime;
});

describe("running probe characterization", () => {
  it("fails an invalid Runtime Binding before any upstream request", async () => {
    const finish = prepareRepository();

    await processSingleRun(runningRun({ runtime_provider_key: "unknown-core" }), new Set());

    expect(requestTraefikInternal).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "UNSUPPORTED_RUNTIME_BINDING",
    }));
  });

  it("persists heartbeat before terminalizing a completed upstream run", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { status: "completed", output: "done", duration_ms: 17 },
    } as never);
    const update = vi.mocked(chatRepo.updateChatRun);

    await processSingleRun(runningRun(), new Set());

    const heartbeatIndex = update.mock.calls.findIndex(([, patch]) => Object.prototype.hasOwnProperty.call(patch, "heartbeat_at"));
    expect(heartbeatIndex).toBeGreaterThanOrEqual(0);
    expect(update.mock.invocationCallOrder[heartbeatIndex]).toBeLessThan(finish.mock.invocationCallOrder[0]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "completed",
      assistantContent: "done",
      durationMs: 17,
    }));
  });

  it("stops after heartbeat persistence loses the lease", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { status: "completed", output: "stale" },
    } as never);
    vi.mocked(chatRepo.updateChatRun).mockImplementation(async (_id, patch) => !Object.prototype.hasOwnProperty.call(patch, "heartbeat_at"));
    const lost = new Set<string>();

    await processSingleRun(runningRun(), lost);

    expect(lost.has(runId)).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    expect(getEventsFromCache(runId, 0).events).toEqual([]);
  });

  it("emits only the appended partial-output delta and persists the full output", async () => {
    prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { status: "running", partial_output: "hello world" },
    } as never);

    await processSingleRun(runningRun({ partial_output: "hello" }), new Set());

    const textEvents = getEventsFromCache(runId, 0).events.filter((event) => event.event === "text");
    expect(textEvents.map((event) => event.data)).toEqual([" world"]);
    expect(chatRepo.updateChatRun).toHaveBeenCalledWith(runId, { partial_output: "hello world" }, RECONCILER_ID);
  });

  it("requests upstream stop before expiring an over-runtime run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:02:00.000Z"));
    process.env.MYBAY_ASYNC_CHAT_MAX_RUNTIME_SECONDS = "60";
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({ ok: true, statusCode: 202, json: {} } as never);

    await processSingleRun(runningRun({ created_at: "2026-08-17T00:00:00.000Z" }), new Set());

    const stopCall = vi.mocked(requestTraefikInternal).mock.calls.findIndex(([options]) => options.path.endsWith("/stop"));
    expect(stopCall).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(requestTraefikInternal).mock.invocationCallOrder[stopCall]).toBeLessThan(finish.mock.invocationCallOrder[0]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "expired",
      errorCode: "RUNTIME_TIMEOUT_EXCEEDED",
    }));
  });

  it("terminalizes a 404 probe without writing heartbeat", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({ ok: false, statusCode: 404, error: "missing" } as never);

    await processSingleRun(runningRun(), new Set());

    expect(vi.mocked(chatRepo.updateChatRun).mock.calls.some(([, patch]) => Object.prototype.hasOwnProperty.call(patch, "heartbeat_at"))).toBe(false);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      status: "failed",
      errorCode: "UPSTREAM_RUN_NOT_FOUND",
    }));
  });
});

describe("stopping probe characterization", () => {
  it("uses an already-completed probe result without issuing another stop request", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { status: "completed", output: "already done" },
    } as never);

    await processSingleRun(stoppingRun(), new Set());

    expect(requestTraefikInternal).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", assistantContent: "already done" }));
  });

  it("persists the stop attempt before POST and accepts immediate cancellation", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockImplementation(async (options) => options.method === "GET"
      ? { ok: true, statusCode: 200, json: { status: "running" } } as never
      : { ok: true, statusCode: 202, json: { status: "cancelled" } } as never);
    const update = vi.mocked(chatRepo.updateChatRun);

    await processSingleRun(stoppingRun(), new Set());

    const attemptIndex = update.mock.calls.findIndex(([, patch]) => Object.prototype.hasOwnProperty.call(patch, "stop_attempts"));
    const postIndex = vi.mocked(requestTraefikInternal).mock.calls.findIndex(([options]) => options.method === "POST");
    expect(update.mock.invocationCallOrder[attemptIndex]).toBeLessThan(vi.mocked(requestTraefikInternal).mock.invocationCallOrder[postIndex]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", errorCode: "CANCELLED_UPSTREAM" }));
  });

  it("keeps stopping after a failed stop request", async () => {
    const finish = prepareRepository();
    vi.mocked(requestTraefikInternal).mockImplementation(async (options) => options.method === "GET"
      ? { ok: true, statusCode: 200, json: { status: "running" } } as never
      : { ok: false, statusCode: 503, error: "unavailable" } as never);

    await processSingleRun(stoppingRun(), new Set());

    expect(chatRepo.updateChatRun).toHaveBeenCalledWith(runId, expect.objectContaining({ stop_attempts: 1 }), RECONCILER_ID);
    expect(finish).not.toHaveBeenCalled();
  });
});
