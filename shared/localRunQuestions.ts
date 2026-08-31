export type QuestionSpec = { title: string; multiple: boolean; allowCustom: boolean; options: { id: string; label: string }[] };
export type QuestionAnswer = { selected: string[]; custom: string };
export type LocalRunQuestion = {
  id: string; runId: string; conversationId: string; spec: QuestionSpec;
  status: "pending" | "answered" | "rejected" | "expired";
  answer: QuestionAnswer | null; createdAt: string; expiresAt: string; resolvedAt: string | null;
};
export const QUESTION_ID = /^[A-Za-z0-9_-]{1,80}$/;
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("INVALID_QUESTION");
  return value.trim();
}
export function parseQuestionSpec(input: unknown): QuestionSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_QUESTION");
  const value = input as Record<string, unknown>;
  if (typeof value.multiple !== "boolean" || typeof value.allowCustom !== "boolean" || !Array.isArray(value.options) || value.options.length > 8) throw new Error("INVALID_QUESTION");
  const options = value.options.map(option => {
    if (!option || typeof option !== "object" || Array.isArray(option)) throw new Error("INVALID_QUESTION");
    const id = text(option.id, 40);
    if (!QUESTION_ID.test(id)) throw new Error("INVALID_QUESTION");
    return { id, label: text(option.label, 200) };
  });
  if (new Set(options.map(option => option.id)).size !== options.length || (!options.length && !value.allowCustom)) throw new Error("INVALID_QUESTION");
  return { title: text(value.title, 2000), multiple: value.multiple, allowCustom: value.allowCustom, options };
}
export function parseQuestionAnswer(input: unknown, spec: QuestionSpec): QuestionAnswer {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("INVALID_ANSWER");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.selected) || value.selected.length > 8 || value.selected.some(id => typeof id !== "string" || !spec.options.some(option => option.id === id)) || typeof value.custom !== "string" || value.custom.length > 2000) throw new Error("INVALID_ANSWER");
  const selected = [...new Set(value.selected as string[])].sort();
  const custom = value.custom.trim();
  if (selected.length !== value.selected.length || (custom && !spec.allowCustom) || (!selected.length && !custom) || (!spec.multiple && selected.length + Number(Boolean(custom)) > 1) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(custom)) throw new Error("INVALID_ANSWER");
  return { selected, custom };
}
export function settleRunQuestions(run: { status: string; local_questions?: LocalRunQuestion[] }, now = Date.now()): LocalRunQuestion[] {
  const active = run.status === "running" || run.status === "queued";
  return (run.local_questions || []).map(question => question.status === "pending" && (!active || Date.parse(question.expiresAt) <= now)
    ? { ...question, status: "expired", resolvedAt: new Date(now).toISOString() } : question);
}
