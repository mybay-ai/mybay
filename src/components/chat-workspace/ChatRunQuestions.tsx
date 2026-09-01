import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, apiFetch } from "../../lib/api";
import { parseQuestionAnswer, type LocalRunQuestion, type QuestionAnswer } from "../../../shared/localRunQuestions";

export function QuestionCard({ question, enabled, onAnswer }: { question: LocalRunQuestion; enabled: boolean; onAnswer: (answer: QuestionAnswer | null) => Promise<void> }) {
  const { t } = useTranslation("dashboard");
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = question.status === "pending";
  const lock = useRef(false);
  const submit = async (reject: boolean) => {
    if (!enabled || !pending || lock.current) return;
    let answer: QuestionAnswer | null = null;
    try { if (!reject) answer = parseQuestionAnswer({ selected, custom }, question.spec); }
    catch { setFailed(true); return; }
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try { await onAnswer(answer); }
    catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="my-3 rounded-xl border border-outline bg-surface p-3 text-content" aria-label={t("chatWorkspace.questionTitle")} aria-busy={busy} aria-live="polite">
    <p className="text-xs font-semibold text-primary">{t("chatWorkspace.questionTitle")}</p>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{question.spec.title}</p>
    {pending ? <>
      <fieldset disabled={!enabled || busy} className="mt-3 space-y-2">
        <legend className="sr-only">{question.spec.title}</legend>
        {question.spec.options.map(option => <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-outline px-3 py-2 text-sm">
          <input className="mt-1" type={question.spec.multiple ? "checkbox" : "radio"} name={`question-${question.id}`} checked={selected.includes(option.id)} onChange={() => {
            setFailed(false);
            if (question.spec.multiple) setSelected(previous => previous.includes(option.id) ? previous.filter(id => id !== option.id) : [...previous, option.id]);
            else { setSelected([option.id]); setCustom(""); }
          }} />
          <span className="break-words">{option.label}</span>
        </label>)}
        {question.spec.allowCustom && <label className="block text-xs">{t("chatWorkspace.questionCustom")}
          <textarea rows={2} maxLength={2000} value={custom} onChange={event => { setCustom(event.target.value); if (!question.spec.multiple) setSelected([]); }} className="mt-1 block w-full rounded-lg border border-outline bg-surface p-2 text-sm" />
        </label>}
      </fieldset>
      <p className="mt-2 text-xs text-content-secondary">{t("chatWorkspace.questionWaitNotice")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!enabled || busy} onClick={() => void submit(false)} className="rounded-lg bg-primary px-3 py-2 text-xs text-white disabled:opacity-50">{t(busy ? "chatWorkspace.questionSubmitting" : "chatWorkspace.questionSubmit")}</button>
        <button type="button" disabled={!enabled || busy} onClick={() => void submit(true)} className="rounded-lg border border-outline px-3 py-2 text-xs disabled:opacity-50">{t("chatWorkspace.questionReject")}</button>
      </div>
    </> : <div className="mt-2 text-sm">
      <p role="status">{t(question.status === "answered" ? "chatWorkspace.questionAnswered" : question.status === "rejected" ? "chatWorkspace.questionRejected" : "chatWorkspace.questionExpired")}</p>
      {question.answer && <p className="mt-1 whitespace-pre-wrap break-words">{[...question.spec.options.filter(option => question.answer!.selected.includes(option.id)).map(option => option.label), question.answer.custom].filter(Boolean).join(" · ")}</p>}
    </div>}
    {failed && <p role="alert" className="mt-2 text-xs text-red-600">{t("chatWorkspace.questionAnswerFailed")}</p>}
  </section>;
}

export function ChatRunQuestions({ instanceId, conversationId, runId, knownClosed = false }: { instanceId: string; conversationId: string; runId: string; knownClosed?: boolean }) {
  const { t } = useTranslation("dashboard");
  const [questions, setQuestions] = useState<LocalRunQuestion[]>([]);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(false);
  const base = `/api/instances/${instanceId}/runs/${runId}/questions`;
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let again = true;
      try {
        const result = await apiFetch(`${base}?conversationId=${encodeURIComponent(conversationId)}`, { signal: controller.signal });
        if (disposed) return;
        setQuestions(previous => result.questions.map((incoming: LocalRunQuestion) => {
          const known = previous.find(question => question.id === incoming.id);
          return known && known.status !== "pending" && incoming.status === "pending" ? known : incoming;
        }));
        setActive(result.active === true);
        setError(false);
        again = result.active === true;
      } catch { if (!disposed) { setError(true); setActive(false); } }
      finally { clearTimeout(timeout); if (!disposed && again) timer = setTimeout(() => void poll(), 1500); }
    };
    void poll();
    return () => { disposed = true; alive.current = false; clearTimeout(timer); controller?.abort(); };
  }, [base, conversationId]);
  const answer = async (questionId: string, value: QuestionAnswer | null) => {
    try {
      const result = await api.post(`${base}/${questionId}`, { conversationId, answer: value, reject: value === null });
      if (alive.current) setQuestions(previous => previous.map(question => question.id === questionId ? result.question : question));
    } catch (failure) { if (alive.current) setError(true); throw failure; }
  };
  return <>
    {questions.map(question => <QuestionCard key={question.id} question={knownClosed && question.status === "pending" ? { ...question, status: "expired" } : question} enabled={active && !error && !knownClosed} onAnswer={value => answer(question.id, value)} />)}
    {error && questions.some(question => question.status === "pending") && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("chatWorkspace.questionReconnecting")}</p>}
  </>;
}
