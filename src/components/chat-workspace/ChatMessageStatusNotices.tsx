import { AlertCircle, Clock3, CornerDownRight, Edit3 } from "lucide-react";
import type { TFunction } from "i18next";
import type { ChatMessage } from "../../lib/chatWorkspaceState";

export function ChatMessageStatusNotices({ message, isUser, sending, failureMessage, retryTarget, onRetry, onEdit, onSwitchToAssistAndDiagnose, onReconnectCodexOAuth, reconnectingCodexOAuth, t }: {
  message: ChatMessage;
  isUser: boolean;
  sending: boolean;
  failureMessage: string;
  retryTarget?: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onSwitchToAssistAndDiagnose?: () => void;
  onReconnectCodexOAuth?: () => void;
  reconnectingCodexOAuth?: boolean;
  t: TFunction;
}) {
  const actionClass = isUser ? "border-white/30 bg-white/15 text-white hover:bg-white/25" : "border-outline bg-surface text-content-secondary hover:bg-surface-muted";
  const errorCodeClass = isUser
    ? "border-rose-200/40 bg-rose-950/55 text-rose-50"
    : "border-red-200 bg-red-50 text-red-800 dark:border-rose-400/35 dark:bg-rose-950/55 dark:text-rose-100";
  const actions = retryTarget ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <button type="button" onClick={() => onRetry(retryTarget)} disabled={sending} className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60 ${actionClass}`}>{t("chatWorkspace.retryMessage")}</button>
      {onEdit && <button type="button" onClick={() => onEdit(retryTarget)} disabled={sending} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60 ${actionClass}`}><Edit3 className="h-3 w-3" />{t("chatWorkspace.editAndResend")}</button>}
    </div>
  ) : null;
  if (message.status === "failed") return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 text-[13px] ${isUser ? "text-red-100" : "text-red-600"}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span>{failureMessage}</span>{message.error_code && <code className={`max-w-full break-all rounded border px-1.5 py-0.5 text-[10px] font-semibold ${errorCodeClass}`}>{t("chatWorkspace.errorCodeLabel")}: {message.error_code}</code>}</div>
      {actions}
      {["CODEX_AUTH_REQUIRED", "API_KEY_MISSING"].includes(message.error_code || "") && onReconnectCodexOAuth && <button type="button" onClick={onReconnectCodexOAuth} disabled={sending || reconnectingCodexOAuth} className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60 ${actionClass}`}>{t(reconnectingCodexOAuth ? "chatWorkspace.reconnectingCodexOAuth" : "chatWorkspace.reconnectCodexOAuth")}</button>}
      {onSwitchToAssistAndDiagnose && ["API_KEY_MISSING", "CODEX_AUTH_REQUIRED", "MODEL_CONFIG_MISSING", "DIRECT_MODEL_CHAT_FAILED"].includes(message.error_code || "") && <button type="button" onClick={onSwitchToAssistAndDiagnose} disabled={sending} className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-60 ${actionClass}`}>{t("chatWorkspace.diagnoseWithAssist")}</button>}
    </div>
  );
  if (message.status === "stopped") return <div className={`mt-2 flex flex-wrap items-center gap-2 text-[13px] ${isUser ? "text-amber-100" : "text-amber-600"}`}><div className="flex min-w-0 items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /><span>{message.error_message || t("chatWorkspace.messageStopped")}</span></div>{actions}</div>;
  if (message.status === "queued") return <div className={`mt-2 flex items-center gap-1.5 text-[13px] ${isUser ? "text-amber-100" : "text-amber-600"}`}><Clock3 className="h-3.5 w-3.5" /><span>{message.error_message || t("chatWorkspace.messageQueued")}</span></div>;
  if (message.status === "superseded") return <div className={`mt-2 flex items-center gap-1.5 text-[13px] ${isUser ? "text-indigo-100" : "text-slate-500"}`}><CornerDownRight className="h-3.5 w-3.5" /><span>{message.error_message || t("chatWorkspace.messageSuperseded")}</span></div>;
  return null;
}
