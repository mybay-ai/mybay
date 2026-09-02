import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeLocalDatabase, mutateStore, readStore } from "../../localStore";
import { chatRepo } from "../../repositories/chatRepo";

describe("Run lease repository characterization", () => {
  const relativeStorePath = "data/test-run-lease-store.json";
  const storePath = path.resolve(process.cwd(), relativeStorePath.replace(/\.json$/i, "") + ".sqlite");

  const removeStore = () => {
    closeLocalDatabase();
    for (const file of [storePath, `${storePath}-wal`, `${storePath}-shm`, `${storePath}.migration-complete`]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  };

  const createRun = async (runId = "run-1", instanceId = "instance-1") => {
    const conversation = await chatRepo.createConversation("user-1", instanceId, "Lease test");
    await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId,
      content: "run",
      requestId: `request-${runId}`,
      runId
    });
  };

  const expireLease = (runId: string) => {
    mutateStore((data) => {
      const run = data.chatRuns.find((item) => item.id === runId);
      if (run) run.lease_expires_at = new Date(Date.now() - 1_000).toISOString();
    });
  };

  beforeEach(() => {
    process.env.LOCAL_STORE_PATH = relativeStorePath;
    removeStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    removeStore();
    delete process.env.LOCAL_STORE_PATH;
  });

  it("atomically acquires an unleased run with owner and bounded expiry", async () => {
    await createRun();

    const claimed = await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });
    const stored = readStore().chatRuns.find((run) => run.id === "run-1");

    expect(claimed.map((run) => run.id)).toEqual(["run-1"]);
    expect(stored?.reconciled_by).toBe("worker-a");
    expect(stored?.lease_expires_at).toBe("2026-08-17T00:01:00.000Z");
  });

  it("claims only the requested run without consuming another instance queue", async () => {
    await createRun("run-1", "instance-1");
    await createRun("run-2", "instance-2");

    const claimed = await chatRepo.claimRunById({
      runId: "run-2",
      reconcilerId: "worker-targeted",
      leaseSeconds: 60,
    });

    expect(claimed?.id).toBe("run-2");
    expect(readStore().chatRuns.find((run) => run.id === "run-1")?.reconciled_by).toBeFalsy();
    expect(readStore().chatRuns.find((run) => run.id === "run-2")?.reconciled_by).toBe("worker-targeted");
    expect((await chatRepo.claimRuns({ reconcilerId: "worker-broad", leaseSeconds: 60 })).map((run) => run.id))
      .toEqual(["run-1"]);
  });

  it("reuses a same-owner initial lease without extending or rewriting it", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Initial lease test");
    await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "run",
      requestId: "request-initial-lease",
      runId: "run-initial-lease",
      initialLease: { reconcilerId: "worker-targeted", leaseSeconds: 60 },
    });
    const before = readStore().chatRuns.find((run) => run.id === "run-initial-lease");
    vi.advanceTimersByTime(10_000);

    const claimed = await chatRepo.claimRunById({
      runId: "run-initial-lease",
      reconcilerId: "worker-targeted",
      leaseSeconds: 60,
    });
    const after = readStore().chatRuns.find((run) => run.id === "run-initial-lease");

    expect(claimed?.id).toBe("run-initial-lease");
    expect(before?.reconciled_by).toBe("worker-targeted");
    expect(before?.lease_expires_at).toBe("2026-08-17T00:01:00.000Z");
    expect(after?.lease_expires_at).toBe(before?.lease_expires_at);
    expect(after?.updated_at).toBe(before?.updated_at);
    expect(await chatRepo.claimRunById({
      runId: "run-initial-lease",
      reconcilerId: "worker-other",
      leaseSeconds: 60,
    })).toBeNull();
  });

  it("prevents another owner from claiming or mutating an active lease", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });

    expect(await chatRepo.claimRuns({ reconcilerId: "worker-b", leaseSeconds: 60 })).toEqual([]);
    expect(await chatRepo.updateChatRun("run-1", { status: "running" }, "worker-b")).toBe(false);
    expect((await chatRepo.finishChatRun({
      runId: "run-1",
      status: "failed",
      reconcilerId: "worker-b"
    })).status).toBe("lease_lost");
    expect(readStore().chatRuns.find((run) => run.id === "run-1")?.status).toBe("queued");
  });

  it("reclaims an expired lease for a different owner and fences the stale owner", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });
    expireLease("run-1");

    expect((await chatRepo.claimRuns({ reconcilerId: "worker-b", leaseSeconds: 60 }))).toHaveLength(1);
    expect(await chatRepo.renewRunLease({ runId: "run-1", reconcilerId: "worker-a", leaseSeconds: 60 })).toBe(false);
    expect(await chatRepo.releaseRunLease({ runId: "run-1", reconcilerId: "worker-a" })).toBe(false);
    expect(readStore().chatRuns.find((run) => run.id === "run-1")?.reconciled_by).toBe("worker-b");
  }, 10_000);

  it("allows same-owner reclaim only after expiry without introducing a generation", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });

    expect(await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 })).toEqual([]);
    expireLease("run-1");
    expect((await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 }))).toHaveLength(1);

    const stored = readStore().chatRuns.find((run) => run.id === "run-1") as Record<string, unknown> | undefined;
    expect(stored?.reconciled_by).toBe("worker-a");
    expect(stored).not.toHaveProperty("lease_generation");
    expect(stored).not.toHaveProperty("generation");
    expect(stored).not.toHaveProperty("stream_generation");
  });

  it("renews only the current active owner without changing ownership", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });
    vi.advanceTimersByTime(10_000);

    expect(await chatRepo.renewRunLease({ runId: "run-1", reconcilerId: "worker-a", leaseSeconds: 60 })).toBe(true);
    const stored = readStore().chatRuns.find((run) => run.id === "run-1");
    expect(stored?.reconciled_by).toBe("worker-a");
    expect(stored?.lease_expires_at).toBe("2026-08-17T00:01:10.000Z");
  });

  it("releases only the matching owner and clears both lease fields", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });

    expect(await chatRepo.releaseRunLease({ runId: "run-1", reconcilerId: "worker-b" })).toBe(false);
    expect(await chatRepo.releaseRunLease({ runId: "run-1", reconcilerId: "worker-a" })).toBe(true);
    const stored = readStore().chatRuns.find((run) => run.id === "run-1");
    expect(stored?.reconciled_by).toBeNull();
    expect(stored?.lease_expires_at).toBeNull();
  });

  it("clears the lease during terminal persistence before the final release attempt", async () => {
    await createRun();
    await chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 });

    const result = await chatRepo.finishChatRun({
      runId: "run-1",
      status: "completed",
      assistantContent: "done",
      reconcilerId: "worker-a",
    });

    expect(result.status).toBe("success");
    const stored = readStore().chatRuns.find((run) => run.id === "run-1");
    expect(stored?.reconciled_by).toBeNull();
    expect(stored?.lease_expires_at).toBeNull();
    expect(await chatRepo.releaseRunLease({ runId: "run-1", reconcilerId: "worker-a" })).toBe(false);
  });

  it("allows exactly one concurrent claimant to become authoritative", async () => {
    await createRun();

    const [a, b] = await Promise.all([
      chatRepo.claimRuns({ reconcilerId: "worker-a", leaseSeconds: 60 }),
      chatRepo.claimRuns({ reconcilerId: "worker-b", leaseSeconds: 60 })
    ]);

    expect(a.length + b.length).toBe(1);
    const owner = readStore().chatRuns.find((run) => run.id === "run-1")?.reconciled_by;
    expect(owner === "worker-a" || owner === "worker-b").toBe(true);
  });
});
