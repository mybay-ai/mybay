import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStore, readStore } from "../localStore";
import { chatRepo, encodeConversationCursor } from "./chatRepo";
import { createLocalRunTimeline } from "../../shared/localRunTimeline";
import { createLocalRunUsage } from "../../shared/localRunUsage";
import { createConfiguredModelEvidence } from "../../shared/localModelEvidence";
import { createChatGroupRun } from "../../shared/chatCollaboration";

describe("chatRepo local status contract", () => {
  it("persists room membership on the conversation and snapshots it on both run messages", async () => {
    const conversation = await chatRepo.createConversation("room-user", "room-instance", "Room");
    const config = { mode: "group" as const, peerIds: ["peer-1"], maxRounds: 1 };
    expect((await chatRepo.updateConversationCollaboration("room-user", conversation.id, config)).collaboration).toEqual(config);
    const groupCollaboration = createChatGroupRun({ runId: "room-run", leader: { id: "room-instance", name: "主持" }, peers: [{ id: "peer-1", name: "研究" }], maxRounds: 1 });
    await chatRepo.beginChatRun({ conversationId: conversation.id, userId: "room-user", instanceId: "room-instance", content: "协作", requestId: "room-request", runId: "room-run", groupCollaboration });
    await chatRepo.finishChatRun({ runId: "room-run", status: "completed", assistantContent: "完成" });
    closeLocalDatabase();
    expect((await chatRepo.getConversation("room-user", conversation.id))?.collaboration).toEqual(config);
    const messages = await chatRepo.listMessages(conversation.id, 10);
    expect(messages.map(message => message.metadata?.group_collaboration)).toEqual([groupCollaboration, groupCollaboration]);
  });

  it("persists recovery provenance and reuses identical submissions even with a new request ID", async () => {
    const c = await chatRepo.createConversation('u','i','Recovery');
    const source = {contextId:'ctx-source',taskId:'task-source',peerId:'peer'};
    const input = {conversationId:c.id,userId:'u',instanceId:'i',content:'review original task',requestId:'first',runId:'recovery-one',a2aRecoverySource:source};
    expect((await chatRepo.beginChatRun(input)).status).toBe('success');
    expect(await chatRepo.beginChatRun({...input,requestId:'second',runId:'recovery-two'})).toMatchObject({status:'IDEMPOTENT_REPLAY',run_id:'recovery-one'});
    await chatRepo.finishChatRun({runId:'recovery-one',status:'completed',assistantContent:'review complete'});
    closeLocalDatabase();
    expect((await chatRepo.getChatRun('recovery-one')).a2a_recovery_source).toEqual(source);
    expect((await chatRepo.beginChatRun({...input,requestId:'third',runId:'recovery-three'})).status).toBe('IDEMPOTENT_REPLAY');
    expect((await chatRepo.beginChatRun({...input,a2aRecoverySource:{...source,taskId:'different'},runId:'collision'})).status).toBe('DUPLICATE_REQUEST_ID');
    expect(readStore().chatRuns.filter(r=>r.instance_id==='i')).toHaveLength(1);
    expect(readStore().chatMessages.find(m=>m.role==='user')?.metadata.a2a_recovery_source).toEqual(source);
    expect(readStore().chatMessages.find(m=>m.role==='assistant')?.metadata.a2a_recovery_source).toEqual(source);
    expect((await chatRepo.beginChatRun({...input,requestId:'changed-input',runId:'changed-input-run',a2aRecoveryFingerprint:'different-attachments'})).status).toBe('success');
  }, 15_000);

  it("persists usage across reopen, with no accumulation, cross-conversation leakage or late overwrite", async () => {
    const c = await chatRepo.createConversation("u", "i", "Usage");
    const other = await chatRepo.createConversation("u", "i", "Other");
    const modelEvidence = createConfiguredModelEvidence("deepseek-v4-flash");
    await chatRepo.beginChatRun({ conversationId: c.id, userId: "u", instanceId: "i", content: "test", requestId: "usage-req", runId: "usage-run", modelEvidence });
    const usageEvidence = createLocalRunUsage({ total_tokens: 100, cache_read_tokens: 0, scope: "session" });
    expect((await chatRepo.finishChatRun({ runId: "usage-run", status: "completed", reconcilerId: "wrong", usageEvidence })).status).toBe("lease_lost");
    expect((await chatRepo.getChatRun("usage-run")).usage_evidence).toBeUndefined();
    await chatRepo.finishChatRun({ runId: "usage-run", status: "completed", usageEvidence });
    await chatRepo.finishChatRun({ runId: "usage-run", status: "completed", usageEvidence: createLocalRunUsage({ total_tokens: 999 }) });
    closeLocalDatabase();
    expect((await chatRepo.getChatRun("usage-run")).usage_evidence).toEqual(usageEvidence);
    const messages = await chatRepo.listMessages(c.id, 100);
    expect(messages.filter(m => m.role === "assistant")).toHaveLength(1);
    expect(messages.find(m => m.role === "assistant")?.metadata?.usage_evidence).toEqual(usageEvidence);
    expect(messages.find(m => m.role === "assistant")?.metadata?.model_evidence).toEqual(modelEvidence);
    expect(await chatRepo.listMessages(other.id, 100)).toEqual([]);
  });
  it("saves Quick response evidence once without changing legacy records", async () => {
    const c = await chatRepo.createConversation("u", "i", "Quick usage");
    const turn = await chatRepo.beginChatTurn({ conversationId: c.id, userId: "u", instanceId: "i", content: "test", requestId: "quick-usage" });
    const usageEvidence = createLocalRunUsage({ total_tokens: 0, model: "reported-model" }, { source: "provider_response" });
    const modelEvidence = createConfiguredModelEvidence("configured-model");
    const input = { conversationId: c.id, userMessageId: turn.message_id!, status: "completed" as const, assistantContent: "done", usageEvidence, modelEvidence };
    await chatRepo.finishChatTurn(input);
    expect((await chatRepo.finishChatTurn(input)).status).toBe("TURN_NOT_PENDING");
    closeLocalDatabase();
    const message = (await chatRepo.listMessages(c.id, 100)).find(m => m.role === "assistant");
    expect(message?.metadata?.usage_evidence).toEqual(usageEvidence);
    expect(message?.metadata?.model_evidence).toEqual(modelEvidence);
  });
  it("persists file snapshots with terminal state, keeps content out of messages, and rejects late replacement", async () => {
    const c = await chatRepo.createConversation("u", "i", "Diff");
    await chatRepo.beginChatRun({ conversationId: c.id, userId: "u", instanceId: "i", content: "test", requestId: "diff-req", runId: "diff-run" });
    const fileDiffs = { version: 1 as const, runId: "diff-run", conversationId: c.id, capturedBefore: new Date().toISOString(), capturedAfter: new Date().toISOString(), files: [{ path: "a.txt", before: "PREIMAGE", after: "POSTIMAGE" }] };
    expect((await chatRepo.finishChatRun({ runId: "diff-run", status: "completed", reconcilerId: "wrong-lease", fileDiffs })).status).toBe("lease_lost");
    expect((await chatRepo.getChatRun("diff-run")).file_diffs).toBeUndefined();
    await chatRepo.finishChatRun({ runId: "diff-run", status: "completed", fileDiffs });
    closeLocalDatabase();
    expect((await chatRepo.getChatRun("diff-run")).file_diffs).toEqual(fileDiffs);
    expect(JSON.stringify(readStore().chatMessages)).not.toContain("PREIMAGE");
    await chatRepo.finishChatRun({ runId: "diff-run", status: "completed", fileDiffs: { ...fileDiffs, files: [] } });
    expect((await chatRepo.getChatRun("diff-run")).file_diffs).toEqual(fileDiffs);
  });
  it("persists a terminal timeline atomically and does not overwrite it on a late completion", async () => {
    const c = await chatRepo.createConversation("u", "i", "Timeline");
    await chatRepo.beginChatRun({ conversationId: c.id, userId: "u", instanceId: "i", content: "test", requestId: "timeline-req", runId: "timeline-run" });
    const timeline = createLocalRunTimeline({ runId: "timeline-run", conversationId: c.id, status: "completed", events: [{ id: 1, event: "text", data: "Final" }] });
    await chatRepo.finishChatRun({ runId: "timeline-run", status: "cancelled", assistantContent: "Final", timeline });
    closeLocalDatabase();
    const message = readStore().chatMessages.find(m => m.role === "assistant");
    expect(message?.metadata.run_timeline).toEqual({ ...timeline, status: "cancelled" });
    await chatRepo.finishChatRun({ runId: "timeline-run", status: "completed", timeline: { ...timeline, events: [] } });
    expect(readStore().chatMessages.filter(m => m.role === "assistant")).toHaveLength(1);
    expect(readStore().chatMessages.find(m => m.role === "assistant")?.metadata.run_timeline.status).toBe("cancelled");
  });
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

  it("returns failed_logged after persisting a failed synchronous turn", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Failure");
    const started = await chatRepo.beginChatTurn({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "hello", requestId: "failure-1" });
    const result = await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: started.message_id!, status: "failed", errorCode: "DIRECT_MODEL_CHAT_FAILED" });
    expect(result.status).toBe("failed_logged");
    expect(readStore().chatMessages.filter(message => message.conversation_id === conversation.id)).toEqual([
      expect.objectContaining({ role: "user", status: "failed", error_code: "DIRECT_MODEL_CHAT_FAILED" }),
      expect.objectContaining({ role: "assistant", status: "failed", error_code: "DIRECT_MODEL_CHAT_FAILED" }),
    ]);
    const duplicate = await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: started.message_id!, status: "failed", errorCode: "OTHER" });
    expect(duplicate.status).toBe("TURN_NOT_PENDING");
    expect(readStore().chatMessages.filter(message => message.conversation_id === conversation.id)).toHaveLength(2);
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
    expect(readStore().chatRuns.find(run => run.id === "run-1")).toMatchObject({
      runtime_type: "hermes",
      runtime_provider_key: "hermes-core",
      runtime_contract_version: 1,
    });

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
    expect(claimed[0]).toMatchObject({
      runtime_type: "hermes",
      runtime_provider_key: "hermes-core",
      runtime_contract_version: 1,
    });
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

  it.each(["cancelled", "failed", "expired"] as const)(
    "does not replay the user instruction of a %s run as completed context",
    async (status) => {
      const conversation = await chatRepo.createConversation("user-1", "instance-1", "Context");
      const successful = await chatRepo.beginChatTurn({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "Remember FILE-MARKER", requestId: "success" });
      await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: successful.message_id!, status: "completed", assistantContent: "FILE-MARKER remembered" });
      const stopped = await chatRepo.beginChatRun({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "Wait then reply WAIT-DONE", requestId: "stopped", runId: "stopped" });
      await chatRepo.finishChatRun({ runId: "stopped", status, assistantContent: "Partial stopped output", errorCode: "STOPPED" });

      // Existing databases intentionally retain a completed user row for failed runs.
      expect((await chatRepo.getMessage(stopped.user_message_id!))?.status).toBe("completed");
      const context = await chatRepo.getLatestCompletedMessagesForContext(conversation.id, 2);
      expect(context.map(message => message.content)).toEqual(["Remember FILE-MARKER", "FILE-MARKER remembered"]);
      expect(context.some(message => message.request_id === "stopped")).toBe(false);
      // Context filtering must not delete or rewrite the visible transcript.
      expect(await chatRepo.listMessages(conversation.id)).toHaveLength(4);

      await chatRepo.beginChatRun({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "Read the file marker", requestId: "follow-up", runId: "follow-up" });
      await chatRepo.finishChatRun({ runId: "follow-up", status: "completed", assistantContent: "FILE-MARKER" });
      expect((await chatRepo.getLatestCompletedMessagesForContext(conversation.id, 2)).map(message => message.content)).toEqual(["Read the file marker", "FILE-MARKER"]);
    },
  );

  it("scopes failed-turn context filtering to the conversation and preserves unpaired legacy history", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Context");
    const foreign = await chatRepo.createConversation("user-2", "instance-2", "Foreign");
    const successful = await chatRepo.beginChatTurn({ conversationId: conversation.id, userId: "user-1", instanceId: "instance-1", content: "Keep this", requestId: "shared-request" });
    await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: successful.message_id!, status: "completed", assistantContent: "Kept" });
    const failed = await chatRepo.beginChatTurn({ conversationId: foreign.id, userId: "user-2", instanceId: "instance-2", content: "Foreign failure", requestId: "shared-request" });
    await chatRepo.finishChatTurn({ conversationId: foreign.id, userMessageId: failed.message_id!, status: "failed" });
    mutateStore(data => {
      data.chatMessages.push({ ...data.chatMessages[0], id: "legacy", request_id: undefined, sequence_no: 3, content: "Legacy context" });
      data.chatMessages.push({ ...data.chatMessages[0], id: "legacy-failure", request_id: undefined, sequence_no: 4, role: "assistant", status: "failed", content: "" });
    });
    expect((await chatRepo.getLatestCompletedMessagesForContext(conversation.id)).map(message => message.content)).toEqual(["Keep this", "Kept", "Legacy context"]);
  });

  it("rejects mutation of a persisted Run Binding", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Test");
    await chatRepo.beginChatRun({
      conversationId: conversation.id,
      userId: "user-1",
      instanceId: "instance-1",
      content: "run",
      requestId: "binding-request",
      runId: "binding-run",
    });

    expect(await chatRepo.updateChatRun("binding-run", { runtime_type: "pi" })).toBe(false);
    expect(readStore().chatRuns.find(run => run.id === "binding-run")).toMatchObject({
      runtime_type: "hermes",
      runtime_provider_key: "hermes-core",
      runtime_contract_version: 1,
    });
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

  it("searches local conversation titles and message content within the user and instance boundary", async () => {
    const matchingTitle = await chatRepo.createConversation("user-1", "instance-1", "Quarterly launch notes");
    const matchingMessage = await chatRepo.createConversation("user-1", "instance-1", "General planning");
    const foreignUser = await chatRepo.createConversation("user-2", "instance-1", "Quarterly private notes");
    const foreignInstance = await chatRepo.createConversation("user-1", "instance-2", "Quarterly other instance");

    const addCompletedTurn = async (conversationId: string, userId: string, instanceId: string, requestId: string, content: string) => {
      const started = await chatRepo.beginChatTurn({ conversationId, userId, instanceId, requestId, content });
      await chatRepo.finishChatTurn({ conversationId, userMessageId: started.message_id!, status: "completed", assistantContent: `Answer for ${content}` });
    };
    await addCompletedTurn(matchingMessage.id, "user-1", "instance-1", "request-local", "Discuss the quarterly roadmap");
    await addCompletedTurn(foreignUser.id, "user-2", "instance-1", "request-foreign-user", "Quarterly secret");
    await addCompletedTurn(foreignInstance.id, "user-1", "instance-2", "request-foreign-instance", "Quarterly elsewhere");

    const results = await chatRepo.searchConversations("user-1", "instance-1", "quarterly", 20);
    expect(results.some(result => result.conversation_id === matchingTitle.id && result.matched_field === "title")).toBe(true);
    expect(results.some(result => result.conversation_id === matchingMessage.id && result.matched_field === "message" && result.message_id)).toBe(true);
    expect(results.some(result => result.conversation_id === foreignUser.id)).toBe(false);
    expect(results.some(result => result.conversation_id === foreignInstance.id)).toBe(false);
  });

  it("keeps title pagination stable across new activity and a database reopen", async () => {
    const conversations = [];
    for (let i = 0; i < 5; i++) conversations.push(await chatRepo.createConversation('user-1', 'instance-1', `needle ${i}`));
    mutateStore(store => {
      for (const conversation of store.conversations) {
        conversation.created_at = '2026-01-01T00:00:00.000Z';
        conversation.updated_at = conversation.created_at;
      }
    });
    const first = await chatRepo.searchConversationPage('user-1', 'instance-1', 'needle', 2);
    mutateStore(store => { for (const conversation of store.conversations) conversation.updated_at = '9999-01-01T00:00:00.000Z'; });
    closeLocalDatabase();
    const second = await chatRepo.searchConversationPage('user-1', 'instance-1', 'needle', 3, first.nextCursor!);
    expect(new Set([...first.results, ...second.results].map(result => result.conversation_id))).toEqual(new Set(conversations.map(row => row.id)));
    expect(second.nextCursor).toBeNull();
  });

  it("returns bounded search snippets and respects the result limit", async () => {
    const conversation = await chatRepo.createConversation("user-1", "instance-1", "Search limits");
    for (let index = 0; index < 3; index += 1) {
      const started = await chatRepo.beginChatTurn({
        conversationId: conversation.id,
        userId: "user-1",
        instanceId: "instance-1",
        requestId: `search-${index}`,
        content: `${"prefix ".repeat(40)}needle ${index} ${"suffix ".repeat(40)}`
      });
      await chatRepo.finishChatTurn({ conversationId: conversation.id, userMessageId: started.message_id!, status: "completed", assistantContent: "complete" });
    }
    const results = await chatRepo.searchConversations("user-1", "instance-1", "needle", 2);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.snippet.length <= 182 && result.snippet.includes("needle"))).toBe(true);
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
  it("persists bounded run-bound file evidence through a SQLite reopen", async () => {
    const conversation = await chatRepo.createConversation("user", "agent", "Evidence");
    await chatRepo.beginChatRun({ conversationId: conversation.id, userId: "user", instanceId: "agent", content: "edit", requestId: "proof-request", runId: "proof-run" });
    await chatRepo.finishChatRun({ runId: "proof-run", status: "completed", assistantContent: "done", fileEvidence: {
      version: 1, runId: "proof-run", changes: [{ path: "report.html", kind: "modified" }, { path: "/opt/data/.env", kind: "modified" }],
    } });
    closeLocalDatabase();
    const evidence = { version: 1, runId: "proof-run", changes: [{ path: "report.html", kind: "modified" }] };
    expect(readStore().chatMessages.find(message => message.role === "assistant")?.metadata.file_evidence).toEqual(evidence);
    expect((await chatRepo.getChatRun("proof-run")).file_evidence).toEqual(evidence);
    await chatRepo.finishChatRun({ runId: "proof-run", status: "completed", fileEvidence: { version: 1, runId: "other", changes: [{ path: "wrong.html", kind: "added" }] } });
    expect((await chatRepo.getChatRun("proof-run")).file_evidence).toEqual(evidence);
  });

  it("places relative to the complete persisted history and survives reopening", async () => {
    const rows = [];
    for (let i = 0; i < 25; i++) rows.push(await chatRepo.createConversation("u", "i", `Chat ${i}`));
    await chatRepo.reorderConversations("u", "i", rows.map(c => c.id));
    await chatRepo.placeConversation("u", "i", { conversationId: rows[0].id, targetId: rows[1].id, section: { kind: "recent" }, position: "after" });
    closeLocalDatabase();
    expect((await chatRepo.listConversations("u", "i", 100)).map(c => c.id)).toEqual([rows[1].id, rows[0].id, ...rows.slice(2).map(c => c.id)]);
    await chatRepo.placeConversation("u", "i", { conversationId: rows[0].id, targetId: null, section: { kind: "recent" }, position: "after" });
    expect((await chatRepo.listConversations("u", "i", 100)).at(-1)?.id).toBe(rows[0].id);
  }, 15_000);

  it("atomically moves into projects, pins while retaining membership, and returns to recent", async () => {
    const project = await chatRepo.createProject("u", "i", "Project");
    const source = await chatRepo.createConversation("u", "i", "Source");
    const move = (section: any) => chatRepo.placeConversation("u", "i", { conversationId: source.id, targetId: null, section, position: "after" });
    await move({ kind: "project", projectId: project.id });
    expect(await chatRepo.getConversation("u", source.id)).toMatchObject({ project_id: project.id, pinned_at: null });
    await move({ kind: "pinned" });
    expect(await chatRepo.getConversation("u", source.id)).toMatchObject({ project_id: project.id, pinned_at: expect.any(String) });
    await move({ kind: "recent" });
    expect(await chatRepo.getConversation("u", source.id)).toMatchObject({ project_id: null, pinned_at: null, title: "Source" });
  });

  it("rejects cross-instance, cross-owner, archived project and stale-target drops without partial writes", async () => {
    const source = await chatRepo.createConversation("u", "i", "Source");
    const foreign = await chatRepo.createConversation("u", "other", "Foreign");
    const alien = await chatRepo.createConversation("other-user", "i", "Alien");
    const project = await chatRepo.createProject("u", "other", "Foreign project");
    const archived = await chatRepo.createProject("u", "i", "Archived");
    await chatRepo.archiveProject("u", "i", archived.id);
    const pinned = await chatRepo.createConversation("u", "i", "Pinned");
    await chatRepo.updateConversationOrganization("u", pinned.id, { pinnedAt: new Date().toISOString() });
    const before = structuredClone(readStore());
    for (const patch of [
      { conversationId: foreign.id }, { conversationId: alien.id }, { targetId: foreign.id }, { targetId: pinned.id },
      { section: { kind: "project", projectId: project.id } }, { section: { kind: "project", projectId: archived.id } },
    ]) {
      await expect(chatRepo.placeConversation("u", "i", { conversationId: source.id, targetId: null, section: { kind: "recent" }, position: "after", ...patch } as any)).rejects.toThrow("CONVERSATION_ORDER_INVALID");
      expect(readStore()).toEqual(before);
    }
  });

});
