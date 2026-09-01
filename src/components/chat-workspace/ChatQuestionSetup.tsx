import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";

type BridgeStatus = {
  configured: boolean;
  supported: boolean | null;
  healthy: boolean;
  installable: boolean;
  repairable: boolean;
  reason: "healthy" | "not_configured" | "unsupported_image" | "container_unavailable" | "container_stopped" | "network_unavailable" | "plugin_unavailable";
};

export function ChatQuestionSetup({ instanceId, busy }: { instanceId: string; busy: boolean }) {
  const { t } = useTranslation("dashboard");
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setStatus(null);
    setLoadFailed(false);
    void api.get(`/api/instances/${instanceId}/question-bridge`)
      .then(result => { if (live) setStatus(result as BridgeStatus); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, [instanceId, reload]);
  const install = async () => {
    if (busy || installing) return;
    setInstalling(true); setFailed(false);
    try { await api.post(`/api/instances/${instanceId}/question-bridge/install`, { restart: true }); setReload(value => value + 1); }
    catch { setFailed(true); }
    finally { setInstalling(false); }
  };
  const healthy = status?.healthy === true;
  const missing = status?.reason === "not_configured";
  const checking = status === null && !loadFailed;
  const abnormal = Boolean(status && !healthy && !missing);
  const Icon = loadFailed || abnormal ? CircleAlert : healthy ? CheckCircle2 : missing ? MessageCircleQuestion : LoaderCircle;
  const reasonDescription = status && abnormal ? `chatWorkspace.questionHealth_${status.reason}` : null;
  return <section className="rounded-xl border border-outline bg-surface-muted/70 p-3" aria-label={t("chatWorkspace.questionSetupTitle")}>
    <div className="flex items-start gap-2.5">
      <div className={`mt-0.5 rounded-lg p-1.5 ${loadFailed || abnormal ? "bg-red-500/10 text-red-500 dark:text-red-300" : healthy ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"}`}>
        <Icon className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-content">{t("chatWorkspace.questionSetupTitle")}</div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${loadFailed || abnormal ? "border-red-400/30 bg-red-500/10 text-red-600 dark:text-red-300" : healthy ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-outline bg-surface text-content-muted"}`}>
            {t(loadFailed || abnormal ? "chatWorkspace.questionStatusUnavailable" : healthy ? "chatWorkspace.questionStatusEnabled" : missing ? "chatWorkspace.questionStatusNotInstalled" : "chatWorkspace.questionStatusChecking")}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-content-muted">
          {t(loadFailed ? "chatWorkspace.questionStatusFailed" : healthy ? "chatWorkspace.questionHealthy" : missing ? "chatWorkspace.questionSetupNotice" : reasonDescription || "chatWorkspace.questionStatusCheckingDesc")}
        </p>
        {loadFailed && <button type="button" onClick={() => setReload(value => value + 1)} className="mt-3 rounded-lg border border-outline bg-surface px-3 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-muted">{t("chatWorkspace.questionStatusRetry")}</button>}
        {missing && status.installable && <button type="button" disabled={busy || installing} onClick={() => void install()} className="mt-3 rounded-lg border border-outline bg-surface px-3 py-2 text-xs font-semibold text-content-secondary hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50">{t(installing ? "chatWorkspace.questionInstalling" : "chatWorkspace.questionInstall")}</button>}
        {abnormal && status?.repairable && <button type="button" disabled={busy || installing} onClick={() => void install()} className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300">{t(installing ? "chatWorkspace.questionInstalling" : "chatWorkspace.questionReinstall")}</button>}
        {failed && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{t("chatWorkspace.questionInstallFailed")}</p>}
      </div>
    </div>
  </section>;
}
