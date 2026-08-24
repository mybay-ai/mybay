import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStore, readStore } from "../localStore";
import { chatRepo, encodeConversationCursor } from "./chatRepo";

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

    const replay = await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "run",
      requestId: "run-request-1",
      runId: "run-replay",
    });
    expect(replay).toMatchObject({
      status: "IDEMPOTENT_REPLAY",
      run_id: "run-1",
      run_status: "queued",
      user_message_id: first.user_message_id,
      sequence_no: first.sequence_no,
    });

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

  it("merges message metadata without losing the run association", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Test");
    const started = await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "inspect this file",
      requestId: "run-with-attachment",
      runId: "run-with-attachment",
    });

    await chatRepo.updateChatMessageMetadata(started.user_message_id!, {
      attachmentIds: ["file-1"],
      attachments: [{ fileId: "file-1", filename: "notes.txt" }],
    });

    const message = readStore().chatMessages.find(item => item.id === started.user_message_id);
    expect(message?.metadata).toMatchObject({
      run_id: "run-with-attachment",
      attachmentIds: ["file-1"],
    });
  });

  it("atomically persists a partial conversation order within one user and instance", async () => {
    const first = await chatRepo.createConversation("user-1", "instance-1", "First");
    const second = await chatRepo.createConversation("user-1", "instance-1", "Second");
    const third = await chatRepo.createConversation("user-1", "instance-1", "Third");
    const foreign = await chatRepo.createConversation("user-2", "instance-1", "Foreign");
    const otherInstance = await chatRepo.createConversation("user-1", "instance-2", "Other instance");

    const reordered = await chatRepo.reorderConversations("user-1", "instance-1", [first.id, third.id]);
    expect(reordered.map(item => item.id)).toEqual([first.id, third.id, second.id]);
    expect((await chatRepo.listConversations("user-1", "instance-1", 10)).map(item => item.id)).toEqual([first.id, third.id, second.id]);
    expect((await chatRepo.listConversations("user-2", "instance-1", 10)).map(item => item.id)).toEqual([foreign.id]);
    expect((await chatRepo.listConversations("user-1", "instance-2", 10)).map(item => item.id)).toEqual([otherInstance.id]);
  });

  it("rejects invalid conversation ordering without partially changing data", async () => {
    const first = await chatRepo.createConversation("user-1", "instance-1", "First");
    const second = await chatRepo.createConversation("user-1", "instance-1", "Second");
    const before = (await chatRepo.listConversations("user-1", "instance-1", 10)).map(item => item.id);
    await expect(chatRepo.reorderConversations("user-1", "instance-1", [first.id, first.id])).rejects.toThrow("CONVERSATION_ORDER_INVALID");
    await expect(chatRepo.reorderConversations("user-1", "instance-1", [second.id, "foreign-id"])).rejects.toThrow("CONVERSATION_ORDER_INVALID");
    expect((await chatRepo.listConversations("user-1", "instance-1", 10)).map(item => item.id)).toEqual(before);
  });

  it("persists project order without touching another instance", async () => {
    const first = await chatRepo.createProject("user-1", "instance-1", "First");
    const second = await chatRepo.createProject("user-1", "instance-1", "Second");
    const foreign = await chatRepo.createProject("user-1", "instance-2", "Foreign");
    await chatRepo.reorderProjects("user-1", "instance-1", [first.id, second.id]);
    expect((await chatRepo.listProjects("user-1", "instance-1")).map(item => item.id)).toEqual([first.id, second.id]);
    expect((await chatRepo.listProjects("user-1", "instance-2")).map(item => item.id)).toEqual([foreign.id]);
  });

  it("continues stable pagination with the persisted sort cursor", async () => {
    const first = await chatRepo.createConversation("user-1", "instance-1", "First");
    const second = await chatRepo.createConversation("user-1", "instance-1", "Second");
    const third = await chatRepo.createConversation("user-1", "instance-1", "Third");
    await chatRepo.reorderConversations("user-1", "instance-1", [second.id, first.id, third.id]);
    const page = await chatRepo.listConversations("user-1", "instance-1", 2);
    expect(page.map(item => item.id)).toEqual([second.id, first.id]);
    const next = await chatRepo.listConversations("user-1", "instance-1", 2, encodeConversationCursor(page[1]));
    expect(next.map(item => item.id)).toEqual([third.id]);
  });

  it("continues accepting the legacy updated_at and id cursor", async () => {
    const first = await chatRepo.createConversation("user-1", "instance-1", "First");
    const second = await chatRepo.createConversation("user-1", "instance-1", "Second");
    mutateStore(data => {
      const firstRow = data.conversations.find(item => item.id === first.id);
      const secondRow = data.conversations.find(item => item.id === second.id);
      if (firstRow) Object.assign(firstRow, { sort_order: null, updated_at: "2026-01-01T00:00:00.000Z" });
      if (secondRow) Object.assign(secondRow, { sort_order: null, updated_at: "2026-01-02T00:00:00.000Z" });
    });
    const next = await chatRepo.listConversations("user-1", "instance-1", 10, `2026-01-02T00:00:00.000Z|${second.id}`);
    expect(next.map(item => item.id)).toEqual([first.id]);
  });
});
