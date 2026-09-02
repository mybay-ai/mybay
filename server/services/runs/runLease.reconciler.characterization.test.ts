import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRepo } from "../../repositories/chatRepo";
import {
  requestRunsReconcile,
  startRunsReconciler,
  stopRunsReconciler
} from "../runsReconciler";

const external = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  requestTraefikInternal: vi.fn(),
  streamTraefikInternalSse: vi.fn()
}));

vi.mock("../../db", () => ({
  dbAdapter: { getInstanceById: external.getInstanceById }
}));

vi.mock("../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: () => ({ ok: true, apiKey: "test-key" })
}));

vi.mock("../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: external.requestTraefikInternal
}));

vi.mock("../../utils/traefikInternalSse", () => ({
  streamTraefikInternalSse: external.streamTraefikInternalSse
}));

vi.mock("../instances/resourceAuthorityService", () => ({
  resolveRunDispatchAuthority: vi.fn(async (run: any) => ({
    ok: true, actor: { kind: "system", id: "test" }, ownerId: run.user_id,
    instance: { id: run.instance_id }, conversation: { id: run.conversation_id }, run,
  })),
}));

const claimedRun = (status: string, overrides: Record<string, unknown> = {}) => ({
  id: "run-lease-order",
  conversation_id: "conversation-1",
  user_id: "user-1",
  instance_id: "instance-1",
  user_message_id: "message-1",
  status,
  upstream_run_id: null,
  dispatch_attempts: 0,
  partial_output: "",
  last_event_seq: 0,
  runtime_type: "hermes",
  runtime_provider_key: "hermes-core",
  runtime_contract_version: 1,
  created_at: new Date().toISOString(),
  ...overrides
});

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe("Runs reconciler lease lifecycle characterization", () => {
  afterEach(() => {
    stopRunsReconciler();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("persists successful terminal state before releasing the lease", async () => {
    const order: string[] = [];
    vi.spyOn(chatRepo, "claimRuns")
      .mockImplementationOnce(async () => {
        order.push("acquire");
        return [claimedRun("running", { upstream_run_id: "upstream-1" })];
      })
      .mockResolvedValue([]);
    vi.spyOn(chatRepo, "renewRunLease").mockResolvedValue(true);
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    vi.spyOn(chatRepo, "finishChatRun").mockImplementation(async () => {
      order.push("persist-terminal");
      return { status: "success", assistant_message_id: "assistant-1", assistant_sequence_no: 2 };
    });
    vi.spyOn(chatRepo, "releaseRunLease").mockImplementation(async () => {
      order.push("release");
      return true;
    });
    external.getInstanceById.mockResolvedValue({ id: "instance-1" });
    external.requestTraefikInternal.mockResolvedValue({
      ok: true,
      statusCode: 200,
      json: { status: "completed", output: "done", usage: {} }
    });
    external.streamTraefikInternalSse.mockResolvedValue({ ok: true, statusCode: 200 });

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await vi.waitFor(() => expect(order).toContain("release"));

    expect(order.indexOf("acquire")).toBeLessThan(order.indexOf("persist-terminal"));
    expect(order.indexOf("persist-terminal")).toBeLessThan(order.indexOf("release"));
  });

  it("persists the existing failure path before releasing the lease", async () => {
    const order: string[] = [];
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValueOnce([claimedRun("queued")]).mockResolvedValue([]);
    vi.spyOn(chatRepo, "getMessage").mockResolvedValue(null);
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    vi.spyOn(chatRepo, "finishChatRun").mockImplementation(async () => {
      order.push("persist-failure");
      return { status: "failure_recorded", assistant_message_id: "assistant-1", assistant_sequence_no: 2 };
    });
    vi.spyOn(chatRepo, "releaseRunLease").mockImplementation(async () => {
      order.push("release");
      return true;
    });

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await vi.waitFor(() => expect(order).toContain("release"));

    expect(order).toEqual(["persist-failure", "release"]);
  });

  it("renews every 25 seconds while processing and stops the renew timer afterwards", async () => {
    vi.useFakeTimers();
    let resolveMessage: ((message: null) => void) | undefined;
    const messagePending = new Promise<null>((resolve) => { resolveMessage = resolve; });
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValueOnce([claimedRun("queued")]).mockResolvedValue([]);
    vi.spyOn(chatRepo, "getMessage").mockReturnValue(messagePending);
    const renew = vi.spyOn(chatRepo, "renewRunLease").mockResolvedValue(true);
    const release = vi.spyOn(chatRepo, "releaseRunLease").mockResolvedValue(true);
    vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "lease_lost",
      assistant_message_id: null,
      assistant_sequence_no: null
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25_000);

    expect(renew).toHaveBeenCalledOnce();
    expect(renew).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-lease-order",
      leaseSeconds: 60
    }));

    resolveMessage?.(null);
    await flushMicrotasks(24);
    expect(release).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(renew).toHaveBeenCalledOnce();
  });

  it("marks a rejected renewal as lease-lost and skips release", async () => {
    vi.useFakeTimers();
    let resolveMessage: ((message: null) => void) | undefined;
    const messagePending = new Promise<null>((resolve) => { resolveMessage = resolve; });
    vi.spyOn(chatRepo, "claimRuns").mockResolvedValueOnce([claimedRun("queued")]).mockResolvedValue([]);
    vi.spyOn(chatRepo, "getMessage").mockReturnValue(messagePending);
    vi.spyOn(chatRepo, "renewRunLease").mockResolvedValue(false);
    const release = vi.spyOn(chatRepo, "releaseRunLease").mockResolvedValue(true);
    const finish = vi.spyOn(chatRepo, "finishChatRun").mockResolvedValue({
      status: "lease_lost",
      assistant_message_id: null,
      assistant_sequence_no: null
    });
    vi.spyOn(chatRepo, "getChatRun").mockResolvedValue(null);
    vi.spyOn(chatRepo, "updateChatRun").mockResolvedValue(true);

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25_000);
    resolveMessage?.(null);
    await flushMicrotasks(24);

    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ reconcilerId: expect.any(String) }));
    expect(release).not.toHaveBeenCalled();
  });

  it("preserves release rejection as a swallowed cleanup failure", async () => {
    const claim = vi.spyOn(chatRepo, "claimRuns")
      .mockResolvedValueOnce([claimedRun("unknown")])
      .mockResolvedValue([]);
    const release = vi.spyOn(chatRepo, "releaseRunLease").mockRejectedValue(new Error("release failed"));

    await startRunsReconciler(60_000, { allowInTest: true, cacheCleanupIntervalMs: 60_000 });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(requestRunsReconcile()).toBe(true);
    await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
  });
});
