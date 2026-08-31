import { mutateStoreCollections, readStoreCollections } from "../localStore";
import { QUESTION_ID, parseQuestionAnswer, parseQuestionSpec, settleRunQuestions, type LocalRunQuestion } from "../../shared/localRunQuestions";

export class QuestionError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
function validIdentity(value: unknown): value is string { return typeof value === "string" && QUESTION_ID.test(value); }
function nativeRun(data: ReturnType<typeof readStoreCollections<"chatRuns" | "conversations">>, instanceId: string, nativeId: string, sessionId: string) {
  const matches = data.chatRuns.filter(run => run.instance_id === instanceId && run.upstream_run_id === nativeId && run.runtime_type === "hermes");
  if (matches.length !== 1) throw new QuestionError("QUESTION_RUN_UNAVAILABLE");
  const run = matches[0];
  if (!data.conversations.some(conversation => conversation.id === run.conversation_id && conversation.instance_id === instanceId && String(conversation.user_id) === String(run.user_id) && conversation.session_id === sessionId)) throw new QuestionError("QUESTION_RUN_UNAVAILABLE");
  return run;
}
export const runQuestionsRepo = {
  create(instanceId: string, input: { nativeRunId?: unknown; sessionId?: unknown; id?: unknown; spec?: unknown }) {
    if (!validIdentity(input.nativeRunId) || !validIdentity(input.sessionId) || !validIdentity(input.id)) throw new QuestionError("INVALID_QUESTION", 400);
    let spec;
    try { spec = parseQuestionSpec(input.spec); } catch { throw new QuestionError("INVALID_QUESTION", 400); }
    return mutateStoreCollections(["chatRuns", "conversations"], data => {
      const run = nativeRun(data, instanceId, input.nativeRunId as string, input.sessionId as string);
      run.local_questions = settleRunQuestions(run);
      const questions: LocalRunQuestion[] = run.local_questions;
      const existing = questions.find(question => question.id === input.id);
      if (existing) {
        if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) throw new QuestionError("QUESTION_CONFLICT");
        return existing;
      }
      if (run.status !== "running" || run.stop_requested_at) throw new QuestionError("QUESTION_RUN_UNAVAILABLE");
      if (questions.length >= 20 || questions.some(question => question.status === "pending")) throw new QuestionError("QUESTION_LIMIT");
      const now = Date.now();
      const question: LocalRunQuestion = { id: input.id as string, runId: run.id, conversationId: run.conversation_id, spec,
        status: "pending", answer: null, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(), resolvedAt: null };
      questions.push(question);
      return question;
    });
  },
  poll(instanceId: string, nativeId: string, sessionId: string, questionId: string) {
    const run = nativeRun(readStoreCollections(["chatRuns", "conversations"]), instanceId, nativeId, sessionId);
    const question = runQuestionsRepo.list(run.id).find(value => value.id === questionId);
    if (!question) throw new QuestionError("QUESTION_NOT_FOUND", 404);
    // A stopped/terminal task must never consume an answer that arrived earlier.
    if ((run.status !== "running" || run.stop_requested_at) && question.status === "answered") return { ...question, status: "expired" as const };
    return question;
  },
  list(runId: string): LocalRunQuestion[] {
    const run = readStoreCollections(["chatRuns"]).chatRuns.find(value => value.id === runId);
    if (!run) return [];
    const settled = settleRunQuestions(run);
    if (settled.some((question, index) => question !== run.local_questions[index])) {
      return mutateStoreCollections(["chatRuns"], data => {
        const current = data.chatRuns.find(value => value.id === runId);
        if (!current) return [];
        current.local_questions = settleRunQuestions(current);
        return current.local_questions as LocalRunQuestion[];
      });
    }
    return settled;
  },
  answer(runId: string, questionId: string, input: unknown, reject: boolean) {
    return mutateStoreCollections(["chatRuns"], data => {
      const run = data.chatRuns.find(value => value.id === runId);
      if (!run) throw new QuestionError("QUESTION_NOT_FOUND", 404);
      run.local_questions = settleRunQuestions(run);
      const question = (run.local_questions as LocalRunQuestion[]).find(value => value.id === questionId);
      if (!question) throw new QuestionError("QUESTION_NOT_FOUND", 404);
      if (run.status !== "running" || run.stop_requested_at) throw new QuestionError("QUESTION_EXPIRED");
      let answer = null;
      if (!reject) { try { answer = parseQuestionAnswer(input, question.spec); } catch { throw new QuestionError("INVALID_ANSWER", 400); } }
      const status = reject ? "rejected" : "answered";
      if (question.status === status && JSON.stringify(question.answer) === JSON.stringify(answer)) return question;
      if (question.status !== "pending") throw new QuestionError("QUESTION_ALREADY_RESOLVED");
      Object.assign(question, { answer, status, resolvedAt: new Date().toISOString() });
      return question;
    });
  },
};
