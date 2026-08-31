import { beforeEach, describe, expect, it } from "vitest";
import { closeLocalDatabase, mutateStoreCollections, readStoreCollections } from "../localStore";
import { runQuestionsRepo } from "./runQuestionsRepo";
import { chatRepo } from "./chatRepo";
const spec = { title: "Choose", multiple: false, allowCustom: true, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] };
const request = { nativeRunId: "native", sessionId: "session", id: "question", spec };
beforeEach(() => {
  mutateStoreCollections(["chatRuns", "conversations", "chatMessages"], data => {
    data.chatRuns = [{ id: "run", instance_id: "instance", user_id: "owner", conversation_id: "conversation", upstream_run_id: "native", runtime_type: "hermes", status: "running" }];
    data.conversations = [{ id: "conversation", instance_id: "instance", user_id: "owner", session_id: "session" }];
    data.chatMessages = [];
  });
});
describe("local Run questions", () => {
  it("binds native Run plus session and survives database reopen", () => {
    runQuestionsRepo.create("instance", request);
    closeLocalDatabase();
    expect(runQuestionsRepo.list("run")[0].status).toBe("pending");
    const result = runQuestionsRepo.answer("run", "question", { selected: ["a"], custom: "" }, false);
    closeLocalDatabase();
    expect(runQuestionsRepo.poll("instance", "native", "session", "question")).toEqual(result);
    expect(runQuestionsRepo.list("other")).toEqual([]);
  });
  it("deduplicates a retry but rejects a changed question or second pending question", () => {
    const first = runQuestionsRepo.create("instance", request);
    expect(runQuestionsRepo.create("instance", request)).toEqual(first);
    expect(() => runQuestionsRepo.create("instance", { ...request, spec: { ...spec, title: "Changed" } })).toThrow("QUESTION_CONFLICT");
    expect(() => runQuestionsRepo.create("instance", { ...request, id: "second" })).toThrow("QUESTION_LIMIT");
    expect(runQuestionsRepo.list("run")).toHaveLength(1);
  });
  it("first answer wins and identical retry is idempotent", () => {
    runQuestionsRepo.create("instance", request);
    const answer = { selected: ["a"], custom: "" };
    const first = runQuestionsRepo.answer("run", "question", answer, false);
    expect(runQuestionsRepo.answer("run", "question", answer, false)).toEqual(first);
    expect(() => runQuestionsRepo.answer("run", "question", { selected: ["b"], custom: "" }, false)).toThrow("QUESTION_ALREADY_RESOLVED");
    expect(() => runQuestionsRepo.answer("run", "question", null, true)).toThrow("QUESTION_ALREADY_RESOLVED");
  });
  it.each(["stopping", "completed", "failed", "cancelled", "expired"])("rejects late answers on %s", status => {
    runQuestionsRepo.create("instance", request);
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns[0].status = status; });
    expect(() => runQuestionsRepo.answer("run", "question", { selected: ["a"], custom: "" }, false)).toThrow("QUESTION_EXPIRED");
    expect(runQuestionsRepo.poll("instance", "native", "session", "question").status).toBe("expired");
  });
  it("expires pending questions atomically with the existing stop path", async () => {
    runQuestionsRepo.create("instance", request);
    await chatRepo.requestStopChatRun({ runId: "run", userId: "owner", instanceId: "instance" });
    expect(readStoreCollections(["chatRuns"]).chatRuns[0].local_questions[0].status).toBe("expired");
  });
  it("expires pending questions atomically with terminal commit", async () => {
    runQuestionsRepo.create("instance", request);
    await chatRepo.finishChatRun({ runId: "run", status: "completed" });
    expect(readStoreCollections(["chatRuns"]).chatRuns[0].local_questions[0].status).toBe("expired");
  });
  it("does not disclose accepted answers to a stopped tool waiter", () => {
    runQuestionsRepo.create("instance", request);
    runQuestionsRepo.answer("run", "question", { selected: ["a"], custom: "" }, false);
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns[0].status = "stopping"; });
    expect(runQuestionsRepo.poll("instance", "native", "session", "question").status).toBe("expired");
  });
  it("rejects wrong instances, sessions, unmapped and ambiguous native runs", () => {
    expect(() => runQuestionsRepo.create("other", request)).toThrow("QUESTION_RUN_UNAVAILABLE");
    expect(() => runQuestionsRepo.create("instance", { ...request, sessionId: "other" })).toThrow("QUESTION_RUN_UNAVAILABLE");
    expect(() => runQuestionsRepo.create("instance", { ...request, nativeRunId: "other" })).toThrow("QUESTION_RUN_UNAVAILABLE");
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns.push({ ...data.chatRuns[0], id: "duplicate" }); });
    expect(() => runQuestionsRepo.create("instance", request)).toThrow("QUESTION_RUN_UNAVAILABLE");
  });
  it("honors deadline and explicit rejection", () => {
    runQuestionsRepo.create("instance", request);
    mutateStoreCollections(["chatRuns"], data => { data.chatRuns[0].local_questions[0].expiresAt = new Date(0).toISOString(); });
    expect(runQuestionsRepo.poll("instance", "native", "session", "question").status).toBe("expired");
    const next = runQuestionsRepo.create("instance", { ...request, id: "next" });
    expect(runQuestionsRepo.answer("run", next.id, null, true).status).toBe("rejected");
  });
  it("validates option membership, cardinality and custom text", () => {
    runQuestionsRepo.create("instance", request);
    for (const answer of [{ selected: ["forged"], custom: "" }, { selected: ["a", "b"], custom: "" }, { selected: [], custom: "" }, { selected: ["a"], custom: "also" }, { selected: [], custom: "x".repeat(2001) }]) {
      expect(() => runQuestionsRepo.answer("run", "question", answer, false)).toThrow("INVALID_ANSWER");
    }
    expect(runQuestionsRepo.answer("run", "question", { selected: [], custom: " 中文 " }, false).answer?.custom).toBe("中文");
    runQuestionsRepo.create("instance", { ...request, id: "multi", spec: { ...spec, multiple: true } });
    expect(runQuestionsRepo.answer("run", "multi", { selected: ["b", "a"], custom: "also" }, false).answer).toEqual({ selected: ["a", "b"], custom: "also" });
  });
});
