import { AlertTriangle, CheckCircle2, Clock3, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentInstance } from "../../types";
import { cn } from "../../lib/utils";
import { useLocalInstanceReadiness, type InstanceChatReadinessProbe } from "../../hooks/useLocalInstanceReadiness";

type Props = {
  instance: AgentInstance;
  chatReadiness?: InstanceChatReadinessProbe | null;
  compact?: boolean;
};

export function InstanceReadinessNotice({ instance, chatReadiness, compact = false }: Props) {
  const { t } = useTranslation("dashboard");
  const readiness = useLocalInstanceReadiness(instance, chatReadiness);
  const failed = readiness.phase === "deployment_failed" || readiness.phase === "chat_auth_or_route_failed";
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
          {!compact && <div className="mt-1 text-xs leading-5 opacity-90">{readiness.message || t(`${key}_description`)}</div>}
          {readiness.reason && readiness.phase !== "deployment_failed" && (
            <code className="mt-1 inline-block break-all text-[10px] opacity-75">{readiness.reason}</code>
          )}
        </div>
      </div>
    </div>
  );
}
