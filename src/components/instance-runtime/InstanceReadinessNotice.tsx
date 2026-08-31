import { AlertTriangle, CheckCircle2, Clock3, Settings2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentInstance } from "../../types";
import { cn } from "../../lib/utils";
import { useLocalInstanceReadiness, type InstanceChatReadinessProbe } from "../../hooks/useLocalInstanceReadiness";

type Props = {
  instance: AgentInstance;
  chatReadiness?: InstanceChatReadinessProbe | null;
  compact?: boolean;
  onProbe?: (probe: InstanceChatReadinessProbe) => void;
  onOpenDiagnostics?: () => void;
  onOpenLogs?: () => void;
  onOpenSettings?: () => void;
  onOpenChannels?: () => void;
};

export function InstanceReadinessNotice({ instance, chatReadiness, compact = false, onProbe, onOpenDiagnostics, onOpenLogs, onOpenSettings, onOpenChannels }: Props) {
  const { t } = useTranslation("dashboard");
  const readiness = useLocalInstanceReadiness(instance, chatReadiness, onProbe);
  const failed = ["deployment_failed", "chat_auth_or_route_failed", "readiness_check_failed"].includes(readiness.phase);
  const configurationRequired = readiness.phase === "runtime_ready_chat_configuration_required";
  const ready = readiness.phase === "ready";
  const Icon = ready ? CheckCircle2 : failed ? AlertTriangle : configurationRequired ? Settings2 : Clock3;
  const tone = ready
    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200"
    : failed
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200"
      : configurationRequired
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200";
  const key = `readiness_${readiness.phase}`;

  return (
    <div className={cn("rounded-xl border", compact ? "px-3 py-2" : "p-3", tone)} data-readiness-phase={readiness.phase}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 shrink-0", compact ? "h-4 w-4" : "h-5 w-5")} />
        <div className="min-w-0">
          <div className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>{t(`${key}_title`)}</div>
          {!compact && <div className="mt-1 text-xs leading-5 opacity-90">{t(`${key}_description`)}</div>}
          {readiness.reason && readiness.phase !== "deployment_failed" && (
            <code className="mt-1 inline-block break-all text-[10px] opacity-75">{readiness.reason}</code>
          )}
        </div>
      </div>
      {!compact && <>
        <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2" data-readiness-checks>
          {readiness.checks.map(check => <div key={check.key} className="flex min-w-0 justify-between gap-3" data-readiness-check={check.key} data-check-status={check.status}>
            <dt>{t(`readiness_check_${check.key}`)}</dt>
            <dd className="text-right font-medium">{t(`readiness_check_status_${check.status}`)}</dd>
          </div>)}
        </dl>
        <p className="mt-3 text-[11px] leading-5 opacity-90">{t("readiness_evidence_note")}</p>
        <p className="mt-1 text-[11px] opacity-80">{readiness.checking ? t("readiness_checking") : readiness.checkedAt && Number.isFinite(Date.parse(readiness.checkedAt)) ? t("readiness_checked_at", { time: new Date(readiness.checkedAt).toLocaleTimeString() }) : t("readiness_not_checked")}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold">
          <button type="button" onClick={readiness.recheck} disabled={!readiness.canRecheck || readiness.checking} className="inline-flex items-center gap-1 disabled:opacity-50"><RefreshCw className={cn("h-3.5 w-3.5", readiness.checking && "animate-spin")} />{t("readiness_recheck")}</button>
          {onOpenDiagnostics && <button type="button" onClick={onOpenDiagnostics}>{t("readiness_open_diagnostics")}</button>}
          {onOpenLogs && <button type="button" onClick={onOpenLogs}>{t("readiness_open_logs")}</button>}
          {onOpenSettings && <button type="button" onClick={onOpenSettings}>{t("readiness_open_model")}</button>}
          {onOpenChannels && <button type="button" onClick={onOpenChannels}>{t("readiness_open_channels")}</button>}
        </div>
      </>}
    </div>
  );
}
