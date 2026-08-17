import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatApprovalChoice, ChatApprovalRequest } from "../useChatRuns";

type ApprovalResponder = (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void | Promise<void>;

export function InlineApprovalCard({
  approval,
  canRespond,
  onRespond
}: {
  approval: ChatApprovalRequest;
  canRespond: boolean;
  onRespond?: ApprovalResponder;
}) {
  const { t } = useTranslation("dashboard");
  const [submittingChoice, setSubmittingChoice] = useState<ChatApprovalChoice | null>(null);
  const pending = approval.status === "pending";
  const labels: Record<ChatApprovalChoice, string> = {
    once: t("chatWorkspace.approvalChoiceOnce"),
    session: t("chatWorkspace.approvalChoiceSession"),
    always: t("chatWorkspace.approvalChoiceAlways"),
    deny: t("chatWorkspace.approvalChoiceDeny")
  };

  useEffect(() => {
    setSubmittingChoice(null);
  }, [approval.id, approval.status]);

  const submit = async (choice: ChatApprovalChoice) => {
    if (!pending || !canRespond || !onRespond || submittingChoice) return;
    setSubmittingChoice(choice);
    try {
      await onRespond(choice, approval.id);
    } finally {
      setSubmittingChoice(null);
    }
  };

  if (!pending) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t("chatWorkspace.approvalResolved")}
      </div>
    );
  }

  const choices = approval.choices?.length ? approval.choices : (["once", "deny"] as ChatApprovalChoice[]);
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-amber-950 shadow-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" aria-busy={Boolean(submittingChoice)}>
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{t("chatWorkspace.approvalRequiredTitle")}</p>
          <p className="mt-1 text-[12px] leading-5 text-amber-800/85 dark:text-amber-100/75">
            {approval.description || approval.title || t("chatWorkspace.approvalRequiredDesc")}
          </p>
          {approval.command && (
            <pre className="mt-2 max-h-28 overflow-auto rounded-lg border border-amber-200/70 bg-surface/75 p-2 text-[11px] leading-5 text-amber-950 whitespace-pre-wrap dark:border-amber-400/20 dark:text-amber-100">
              {approval.command}
            </pre>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {choices.map(choice => (
              <button
                key={choice}
                type="button"
                disabled={!canRespond || Boolean(submittingChoice)}
                onClick={() => void submit(choice)}
                className={"inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 " + (
                  choice === "deny"
                    ? "border border-rose-200 bg-surface text-rose-600 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    : "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                )}
              >
                {submittingChoice === choice && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {labels[choice] || choice}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
