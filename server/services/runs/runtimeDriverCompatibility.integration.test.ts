import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hermesTransport = vi.hoisted(() => ({
  request: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("../../runtime/adapters/hermes/HermesTransport", () => ({
  requestHermesRunsAPI: hermesTransport.request,
  streamHermesRunEventsAPI: hermesTransport.stream,
}));
vi.mock("../instances/resourceAuthorityService", () => ({
  resolveRunDispatchAuthority: vi.fn(async (run: any) => ({
    ok: true,
    actor: { kind: "system", id: "compatibility-test" },
    ownerId: run.user_id,
    instance: { id: run.instance_id },
    conversation: { id: run.conversation_id },
    run,
  })),
}));

import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { RuntimeRegistry } from "../../runtime/runtimeRegistry";
import {
  createFakeRuntimeDriver,
  type FakeRuntimeDriverFixture,
} from "../../runtime/testing/FakeRuntimeDriver";
import { resolveRunDispatchAuthority } from "../instances/resourceAuthorityService";
import {
  RECONCILER_ID,
  clearEventsCache,
  processSingleRun,
} from "../runsReconciler";

const runIds = [
  "fake-dispatch-run",
  "fake-restored-run",
  "fake-failed-run",
  "fake-stopping-run",
  "fake-unsupported-run",
  "fake-unauthorized-run",
];

function runtimeRun(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status,
    instance_id: "instance-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    user_message_id: "message-1",
    request_id: "request-1",
    upstream_run_id: status === "queued" ? null : "fake-upstream-1",
    dispatch_attempts: 0,
    stop_attempts: 0,
    stop_requested_at: status === "stopping" ? new Date(Date.now() - 1_000).toISOString() : null,
    last_event_seq: 0,
    partial_output: "",
    reasoning_effort: "balanced",
    runtime_type: "fake-runtime",
    runtime_provider_key: "fake-core",
    runtime_contract_version: 1,
    reconciled_by: RECONCILER_ID,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date(Date.now() - 1_000).toISOString(),
    ...overrides,
  };
}

function registryFor(fixture: FakeRuntimeDriverFixture): RuntimeRegistry {
  return new RuntimeRegistry([fixture.driver], fixture.driver.runtimeType);
}

function prepareRepository(run: ReturnType<typeof runtimeRun>) {
  vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({
    id: run.instance_id,
    owner_id: run.user_id,
    config_json: {},
  } as never);
  vi.spyOn(chatRepo, "listMessages").mockResolvedValue([{
    id: run.user_message_id,
    request_id: run.request_id,
    role: "user",
    content: "fake runtime request",
    metadata: {},
  }] as never);
  vi.spyOn(chatRepo, "getLatestCompletedMessagesForContext").mockResolvedValue([]);
  vi.spyOn(chatRepo, "getConversationForSessionBinding").mockResolvedValue(null);
  vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(run as never);
  vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
  vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
    status: "recorded_running",
    run_status: "running",
  });
  return vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
    status: "success",
    assistant_message_id: "assistant-1",
    assistant_sequence_no: 2,
  });
}

describe("second Runtime reconciler compatibility", () => {
  let fixture: FakeRuntimeDriverFixture;

  beforeEach(() => {
    fixture = createFakeRuntimeDriver();
  });

  afterEach(() => {
    for (const runId of runIds) clearEventsCache(runId);
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("dispatches a queued Run through its persisted non-Hermes binding", async () => {
    const run = runtimeRun("fake-dispatch-run", "queued");
    prepareRepository(run);

    await processSingleRun(run, new Set(), { runtimeRegistry: registryFor(fixture) });

    expect(fixture.state.ensuredSessions).toEqual([expect.objectContaining({
      instance_id: "instance-1",
      conversation_id: "conversation-1",
    })]);
    expect(fixture.state.payloads).toEqual([{
      runtime: "fake-runtime",
      session_id: "fake-session",
      input: "fake runtime request",
    }]);
    expect(fixture.state.requests).toContainEqual(expect.objectContaining({
      method: "POST",
      path: "/v1/runs",
      headers: { "Idempotency-Key": "fake-dispatch-run" },
      sessionId: "fake-session",
    }));
    expect(chatRepo.recordDispatchedChatRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-dispatch-run",
      upstreamRunId: "fake-upstream-1",
    }));
    expect(hermesTransport.request).not.toHaveBeenCalled();
    expect(hermesTransport.stream).not.toHaveBeenCalled();
  });

  it("does not submit if the task stops during pre-dispatch snapshot capture", async () => {
    const run = runtimeRun("fake-dispatch-run", "queued");
    prepareRepository(run);
    vi.mocked(chatRepo.getChatRun).mockResolvedValueOnce(run as never).mockResolvedValue({ ...run, status: "stopping" } as never);
    await processSingleRun(run, new Set(), { runtimeRegistry: registryFor(fixture) });
    expect(fixture.state.requests.some(request => request.method === "POST" && request.path === "/v1/runs")).toBe(false);
    expect(chatRepo.recordDispatchedChatRun).not.toHaveBeenCalled();
  });

  it("restores a running Run with a fresh Registry and completes through the same binding", async () => {
    const run = runtimeRun("fake-restored-run", "running");
    const finish = prepareRepository(run);
    const restartedFixture = createFakeRuntimeDriver();
    restartedFixture.state.probeResult = {
      ok: true,
      statusCode: 200,
      json: { status: "completed", output: "restored fake result", duration_ms: 25 },
    };

    await processSingleRun(run, new Set(), {
      runtimeRegistry: registryFor(restartedFixture),
    });

    expect(restartedFixture.state.requests).toContainEqual(expect.objectContaining({
      method: "GET",
      path: "/v1/runs/fake-upstream-1",
    }));
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-restored-run",
      status: "completed",
      assistantContent: "restored fake result",
      durationMs: 25,
    }));
    expect(hermesTransport.request).not.toHaveBeenCalled();
    expect(hermesTransport.stream).not.toHaveBeenCalled();
  });

  it("propagates a second Runtime terminal failure without Hermes fallback", async () => {
    const run = runtimeRun("fake-failed-run", "running");
    const finish = prepareRepository(run);
    fixture.state.probeResult = {
      ok: true,
      statusCode: 200,
      json: { status: "failed", error: "FAKE_UPSTREAM_FAILURE" },
    };

    await processSingleRun(run, new Set(), { runtimeRegistry: registryFor(fixture) });

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-failed-run",
      status: "failed",
      errorCode: "UPSTREAM_FAILED",
    }));
    expect(hermesTransport.request).not.toHaveBeenCalled();
    expect(hermesTransport.stream).not.toHaveBeenCalled();
  });

  it("probes and stops through the bound second Runtime", async () => {
    const run = runtimeRun("fake-stopping-run", "stopping");
    const finish = prepareRepository(run);
    fixture.state.probeResult = {
      ok: true,
      statusCode: 200,
      json: { status: "running" },
    };

    await processSingleRun(run, new Set(), { runtimeRegistry: registryFor(fixture) });

    expect(fixture.state.requests.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: "GET", path: "/v1/runs/fake-upstream-1" },
      { method: "POST", path: "/v1/runs/fake-upstream-1/stop" },
    ]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-stopping-run",
      status: "cancelled",
      errorCode: "CANCELLED_UPSTREAM",
    }));
    expect(hermesTransport.request).not.toHaveBeenCalled();
  });

  it("fails closed before dispatch when the bound Runtime declares no conversation mode", async () => {
    const run = runtimeRun("fake-unsupported-run", "queued");
    const finish = prepareRepository(run);
    const unsupportedFixture = createFakeRuntimeDriver({
      capabilities: {
        conversation: { modes: [] },
        cancellation: { supported: false },
        terminal: { observation: "unsupported" },
        interactions: { approvals: false, questions: false },
      },
    });

    await processSingleRun(run, new Set(), {
      runtimeRegistry: registryFor(unsupportedFixture),
    });

    expect(unsupportedFixture.state.requests).toEqual([]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-unsupported-run",
      status: "failed",
      errorCode: "RUNTIME_CONVERSATION_MODE_UNSUPPORTED",
    }));
    expect(hermesTransport.request).not.toHaveBeenCalled();
  });

  it("applies resource authority before resolving or contacting the second Runtime", async () => {
    const run = runtimeRun("fake-unauthorized-run", "queued");
    const finish = prepareRepository(run);
    vi.mocked(resolveRunDispatchAuthority).mockResolvedValueOnce({
      ok: false,
      status: 404,
      code: "RUN_NOT_FOUND",
    } as never);

    await processSingleRun(run, new Set(), { runtimeRegistry: registryFor(fixture) });

    expect(fixture.state.requests).toEqual([]);
    expect(fixture.state.ensuredSessions).toEqual([]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: "fake-unauthorized-run",
      status: "failed",
      errorCode: "RUN_NOT_FOUND",
    }));
  });
});
