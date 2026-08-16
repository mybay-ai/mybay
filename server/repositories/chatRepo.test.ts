import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStore, readStore } from "../localStore";
import { chatRepo } from "./chatRepo";

describe("chatRepo local status contract", () => {
  const relativeStorePath = "data/test-chat-repo-store.json";
  const storePath = path.resolve(process.cwd(), relativeStorePath.replace(/\.json$/i, "") + ".sqlite");

  const removeStore = () => {
    closeLocalDatabase();
    for (const file of [storePath, `${storePath}-wal`, `${storePath}-shm`, `${storePath}.migration-complete`]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  };

  beforeEach(() => {
    process.env.LOCAL_STORE_PATH = relativeStorePath;
    removeStore();
  });

  afterEach(() => {
    removeStore();
    delete process.env.LOCAL_STORE_PATH;
  });

  it("uses the route-compatible lifecycle for a synchronous chat turn", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Test");
    const first = await chatRepo.beginChatTurn({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "hello",
      requestId: "request-1",
    });

    expect(first.status).toBe("success");
    expect(first.message_id).toBeTruthy();
    expect(readStore().chatMessages.find(message => message.id === first.message_id)?.status).toBe("pending");

    const concurrent = await chatRepo.beginChatTurn({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "second",
      requestId: "request-2",
    });
    expect(concurrent.status).toBe("CONCURRENT_REQUEST");

    const finished = await chatRepo.finishChatTurn({
      conversationId: conversation.id,
      userMessageId: first.message_id!,
      status: "completed",
      assistantContent: "hi",
    });
    expect(finished.status).toBe("success");
    expect(finished.assistant_message_id).toBeTruthy();

    const duplicate = await chatRepo.beginChatTurn({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "hello",
      requestId: "request-1",
    });
    expect(duplicate.status).toBe("DUPLICATE_REQUEST_ID");
  });

  it("expires a stale pending turn before accepting the next request", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Test");
    const first = await chatRepo.beginChatTurn({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "hello",
      requestId: "request-old",
      timeoutSeconds: 180,
    });
    mutateStore(data => {
      const message = data.chatMessages.find(item => item.id === first.message_id);
      if (message) message.created_at = new Date(Date.now() - 181_000).toISOString();
    });

    const next = await chatRepo.beginChatTurn({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "retry",
      requestId: "request-new",
      timeoutSeconds: 180,
    });

    expect(next.status).toBe("success");
    expect(readStore().chatMessages.find(message => message.id === first.message_id)?.error_code).toBe("TURN_TIMEOUT");
  });

  it("uses route-compatible idempotency and completion statuses for async runs", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Test");
    const first = await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "run",
      requestId: "run-request-1",
      runId: "run-1",
      reasoningEffort: "deep",
    });
    expect(first.status).toBe("success");

    const concurrent = await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "run again",
      requestId: "run-request-2",
      runId: "run-2",
    });
    expect(concurrent.status).toBe("CONCURRENT_RUN");

    const duplicate = await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "same run",
      requestId: "run-request-1",
      runId: "run-3",
    });
    expect(duplicate.status).toBe("DUPLICATE_REQUEST_ID");

    const claimed = await chatRepo.claimRuns({ reconcilerId: "test-reconciler", leaseSeconds: 60 });
    expect(claimed[0]?.reasoning_effort).toBe("deep");
    expect((await chatRepo.recordDispatchedChatRun({
      runId: "run-1",
      reconcilerId: "test-reconciler",
      upstreamRunId: "upstream-1"
    })).status).toBe("recorded_running");
    await chatRepo.releaseRunLease({ runId: "run-1", reconcilerId: "test-reconciler" });

    const mismatch = await chatRepo.finishChatRun({
      runId: "run-1",
      status: "completed",
      expectedUpstreamRunId: "wrong-upstream"
    });
    expect(mismatch.status).toBe("upstream_run_mismatch");

    const finished = await chatRepo.finishChatRun({ runId: "run-1", status: "completed", assistantContent: "done", expectedUpstreamRunId: "upstream-1" });
    expect(finished.status).toBe("success");
    expect((await chatRepo.finishChatRun({ runId: "run-1", status: "completed" })).status).toBe("already_terminal");
  });
});
