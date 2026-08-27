import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: vi.fn(() => ({ ok: true, apiKey: "internal-key" })),
}));
vi.mock("../../utils/traefikInternalSse", () => ({
  streamTraefikInternalSse: vi.fn(),
}));
vi.mock("../instances/resourceAuthorityService", () => ({
  resolveRunDispatchAuthority: vi.fn(async (run: any) => ({
    ok: true, actor: { kind: "system", id: "test" }, ownerId: run.user_id,
    instance: { id: run.instance_id }, conversation: { id: run.conversation_id }, run,
  })),
}));

import { dbAdapter } from "../../db";
import { chatRepo } from "../../repositories/chatRepo";
import { streamTraefikInternalSse } from "../../utils/traefikInternalSse";
import { clearEventsCache, getEventsFromCache, processSingleRun } from "../runsReconciler";

const runId = "stream-run-1";

function queuedRun() {
  return {
    id: runId,
    status: "queued",
    upstream_run_id: "upstream-1",
    instance_id: "instance-1",
    conversation_id: "conversation-1",
    user_id: "user-1",
    last_event_seq: 0,
    partial_output: "",
  };
}

function prepareStream() {
  vi.spyOn(dbAdapter, "getInstanceById").mockResolvedValue({ config_json: {} } as never);
  vi.spyOn(chatRepo, "recordDispatchedChatRun").mockResolvedValue({
    status: "recorded_running",
    run_status: "running",
  });
  vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
}

afterEach(() => {
  clearEventsCache(runId);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("upstream SSE stream characterization", () => {
  it("starts only one stream per run and aborts it during cache clear", async () => {
    prepareStream();
    vi.mocked(streamTraefikInternalSse).mockImplementation(() => new Promise(() => undefined));

    await processSingleRun(queuedRun(), new Set());
    await processSingleRun(queuedRun(), new Set());
    await vi.waitFor(() => expect(streamTraefikInternalSse).toHaveBeenCalledTimes(1));

    const options = vi.mocked(streamTraefikInternalSse).mock.calls[0][0];
    expect(options.signal.aborted).toBe(false);
    clearEventsCache(runId);
    expect(options.signal.aborted).toBe(true);
  });

  it("buffers fragmented frames, ignores DONE, and publishes parsed message deltas", async () => {
    prepareStream();
    vi.mocked(streamTraefikInternalSse).mockImplementation(() => new Promise(() => undefined));

    await processSingleRun(queuedRun(), new Set());
    await vi.waitFor(() => expect(streamTraefikInternalSse).toHaveBeenCalledTimes(1));
    const options = vi.mocked(streamTraefikInternalSse).mock.calls[0][0];

    options.onChunk('data: {"event":"message.delta","delta":"hel');
    expect(getEventsFromCache(runId, 0).events.filter((event) => event.event === "text")).toEqual([]);
    options.onChunk('lo"}\n\n');
    options.onChunk("data: [DONE]\n\n");

    const textEvents = getEventsFromCache(runId, 0).events.filter((event) => event.event === "text");
    expect(textEvents.map((event) => event.data)).toEqual(["hello"]);
  });
});
