import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../instances/resourceAuthorityService", () => ({
  resolveRunDispatchAuthority: vi.fn(async (run: any) => ({
    ok: true, actor: { kind: "system", id: "test" }, ownerId: run.user_id,
    instance: { id: run.instance_id }, conversation: { id: run.conversation_id }, run,
  })),
}));
import { chatRepo } from "../../repositories/chatRepo";
import {
  RECONCILER_ID,
  addEventToCache,
  clearEventsCache,
  getEventsFromCache,
  processSingleRun,
} from "../runsReconciler";

function queuedRun() {
  return {
    id: "dispatch-run-1",
    status: "queued",
    upstream_run_id: "upstream-1",
    instance_id: "instance-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    last_event_seq: 0,
    partial_output: "",
    runtime_type: "hermes",
    runtime_provider_key: "hermes-core",
    runtime_contract_version: 1,
  };
}

describe("run dispatch record characterization", () => {
  const runId = "dispatch-run-1";

  afterEach(() => {
    clearEventsCache(runId);
    vi.restoreAllMocks();
  });

  it("publishes stopping when the upstream id is recorded after a stop request", async () => {
    vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "recorded_stopping",
      run_status: "stopping",
    });

    await processSingleRun(queuedRun(), new Set());

    const events = getEventsFromCache(runId, 0).events;
    expect(events.map((event) => event.event)).toEqual(["status"]);
    expect(JSON.parse(events[0].data)).toEqual({ status: "stopping" });
  });

  it("marks the run lost and clears cached events when recording loses the lease", async () => {
    addEventToCache(runId, "status", JSON.stringify({ status: "queued" }));
    vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "lease_lost",
      run_status: null,
    });
    const lost = new Set<string>();

    await processSingleRun(queuedRun(), lost);

    expect(lost.has(runId)).toBe(true);
    expect(getEventsFromCache(runId, 0).events).toEqual([]);
  });

  it("clears cached events when the run is already terminal", async () => {
    addEventToCache(runId, "status", JSON.stringify({ status: "queued" }));
    vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "already_terminal",
      run_status: "completed",
    });

    await processSingleRun(queuedRun(), new Set());

    expect(getEventsFromCache(runId, 0).events).toEqual([]);
  });

  it("fails a still-leased run when the persisted upstream id conflicts", async () => {
    vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "upstream_id_conflict",
      run_status: "queued",
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue({
      id: runId,
      status: "queued",
      reconciled_by: RECONCILER_ID,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "success",
      assistant_message_id: "assistant-1",
      assistant_sequence_no: 2,
    });

    await processSingleRun(queuedRun(), new Set());

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      status: "failed",
      errorCode: "UPSTREAM_RUN_ID_CONFLICT",
      reconcilerId: RECONCILER_ID,
    }));
  });

  it("does not terminalize an upstream id conflict after lease authority is gone", async () => {
    vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
      status: "upstream_id_conflict",
      run_status: "queued",
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue({
      id: runId,
      status: "queued",
      reconciled_by: "another-worker",
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const finish = vi.spyOn(chatRepo, "finishChatRun");

    await processSingleRun(queuedRun(), new Set());

    expect(finish).not.toHaveBeenCalled();
  });
});
