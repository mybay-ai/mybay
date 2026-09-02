import React from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, History, Layers, Loader2, RotateCcw, Terminal, Zap } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { AGENT_UPGRADE_TIMELINE_PHASES, normalizeAgentUpgradePhase } from "../../../shared/agentUpgradePhase";
import { getRuntimeStatusLabel, getUpgradePhaseLabel } from "./versionStatusPresentation";

interface VersionDetailsDrawerProps {
  instance: any | null;
  isRollingBack: boolean;
  isUpgrading: boolean;
  getActiveVersion: (instance: any) => string;
  doesInstanceNeedUpdate: (instance: any) => boolean;
  getInstanceSystemTags: (instance: any) => string[];
  onClose: () => void;
  onOpenLogs: (id: string, event: React.MouseEvent) => void;
  onRollback: (id: string, event: React.MouseEvent) => void;
  onUpgradeLatest: (id: string, event: React.MouseEvent) => void;
}

export function VersionDetailsDrawer({
  instance,
  isRollingBack,
  isUpgrading,
  getActiveVersion,
  doesInstanceNeedUpdate,
  getInstanceSystemTags,
  onClose,
  onOpenLogs,
  onRollback,
  onUpgradeLatest
}: VersionDetailsDrawerProps) {
  const { t } = useTranslation("dashboard");

  if (!instance) return null;

  const isFailed = instance.upgrade_status === "failed";
  const needsUpdate = doesInstanceNeedUpdate(instance);
  const upgradePhase = normalizeAgentUpgradePhase(instance.upgrade_phase, instance.upgrade_status);
  const versionStatus = isFailed
    ? t("versionManagement.details.statusFailed")
    : needsUpdate
      ? t("versionManagement.details.statusOutdated")
      : t("versionManagement.details.statusLatest");

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <Card
        className="h-full w-full max-w-xl rounded-none border-y-0 border-r-0 border-outline bg-surface shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-outline bg-surface-muted flex items-start justify-between gap-4">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2 text-content font-bold text-base">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>{t("versionManagement.details.title")}</span>
            </div>
            <p className="mt-1 text-[13px] text-content-muted truncate">{instance.name} / {instance.id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-content-muted hover:text-content-secondary hover:bg-surface transition-colors"
            title={t("versionManagement.details.close")}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-left">
          <div className="grid grid-cols-2 gap-3">
            <DetailMetric label={t("versionManagement.details.currentVersion")} value={getActiveVersion(instance)} />
            <DetailMetric
              label={t("versionManagement.details.versionStatus")}
              value={versionStatus}
              tone={isFailed ? "red" : needsUpdate ? "amber" : "green"}
            />
            <DetailMetric label={t("versionManagement.details.runtimeStatus")} value={getRuntimeStatusLabel(t, instance.status)} />
            <DetailMetric label={t("versionManagement.details.upgradeTaskStatus")} value={getUpgradePhaseLabel(t, instance)} />
          </div>

          <div className="rounded-2xl border border-outline bg-surface p-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-[13px] font-bold text-content-secondary">{t("versionManagement.progress.title")}</div>
                <p className="text-[12px] text-content-muted mt-1">{t("versionManagement.progress.description")}</p>
              </div>
              <span className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold",
                upgradePhase === "failed" ? "border-red-200 bg-red-50 text-red-700" :
                upgradePhase === "rolling_back" || upgradePhase === "rolled_back" ? "border-orange-200 bg-orange-50 text-orange-700" :
                upgradePhase === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
                "border-blue-200 bg-blue-50 text-blue-700"
              )}>{getUpgradePhaseLabel(t, instance)}</span>
            </div>
            {upgradePhase === "rolling_back" || upgradePhase === "rolled_back" ? (
              <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-3 text-orange-700">
                <RotateCcw className={cn("w-4 h-4 shrink-0", upgradePhase === "rolling_back" && "animate-spin")} />
                <span className="text-[13px] font-bold">{t(`versionManagement.phases.${upgradePhase}`)}</span>
              </div>
            ) : (
              <UpgradeTimeline phase={upgradePhase} />
            )}
            {upgradePhase === "failed" && (
              <p className="mt-3 text-[12px] font-semibold text-red-600">{t("versionManagement.progress.failedHint")}</p>
            )}
          </div>

          <div className="rounded-2xl border border-outline bg-surface overflow-hidden">
            <div className="px-4 py-3 bg-surface-muted border-b border-outline text-[13px] font-bold text-content-secondary">
              {t("versionManagement.details.basicInfo")}
            </div>
            <div className="divide-y divide-outline">
              <DetailRow label={t("versionManagement.details.instanceName")} value={instance.name || "-"} />
              <DetailRow label={t("versionManagement.details.instanceId")} value={instance.id || "-"} mono />
              <DetailRow label={t("versionManagement.details.imageTag")} value={instance.agent_image_tag || "-"} mono />
              <DetailRow label={t("versionManagement.details.agentVersion")} value={instance.agent_version || "-"} mono />
              <DetailRow label={t("versionManagement.details.resolvedVersion")} value={instance.resolved_version || "-"} mono />
            </div>
          </div>

          <div className="rounded-2xl border border-outline bg-surface overflow-hidden">
            <div className="px-4 py-3 bg-surface-muted border-b border-outline text-[13px] font-bold text-content-secondary">
              {t("versionManagement.details.upgradeAndRollback")}
            </div>
            <div className="divide-y divide-outline">
              <DetailRow
                label={t("versionManagement.details.lastUpgradeAt")}
                value={instance.last_upgrade_at ? new Date(instance.last_upgrade_at).toLocaleString(undefined, { hour12: false }) : "-"}
              />
              <DetailRow label={t("versionManagement.details.previousVersion")} value={instance.previous_image_tag || "-"} mono />
              <DetailRow
                label={t("versionManagement.details.rollbackAvailability")}
                value={instance.previous_image_tag ? t("versionManagement.details.rollbackAvailable") : t("versionManagement.details.rollbackUnavailable")}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-outline bg-surface p-4">
            <div className="text-[13px] font-bold text-content-secondary mb-2">{t("versionManagement.details.systemTags")}</div>
            <div className="flex flex-wrap gap-2">
              {getInstanceSystemTags(instance).map((tag) => (
                <span key={tag} className="px-2 py-1 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-[12px] font-bold font-mono">{tag}</span>
              ))}
            </div>
          </div>

          {instance.upgrade_error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
              <div className="flex items-center gap-2 text-[13px] font-bold mb-2">
                <AlertCircle className="w-4 h-4" />
                <span>{t("versionManagement.details.failureReason")}</span>
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{instance.upgrade_error}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-outline bg-surface flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={(e) => { onClose(); onOpenLogs(instance.id, e); }} className="h-9 px-3 rounded-lg text-[13px] font-bold border-outline text-content-secondary hover:bg-surface-muted flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            <span>{t("versionManagement.details.auditLogs")}</span>
          </Button>
          {instance.previous_image_tag && instance.previous_image_tag !== instance.agent_image_tag && (
            <Button onClick={(e) => onRollback(instance.id, e)} disabled={isRollingBack || instance.upgrade_status === "upgrading"} className="h-9 px-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-50">
              {isRollingBack ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
              <span>{t("versionManagement.details.rollback")}</span>
            </Button>
          )}
          <Button onClick={(e) => onUpgradeLatest(instance.id, e)} disabled={isUpgrading || instance.upgrade_status === "upgrading"} className="h-9 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-50">
            {isUpgrading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            <span>{t("versionManagement.details.upgradeLatest")}</span>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function UpgradeTimeline({ phase }: { phase: ReturnType<typeof normalizeAgentUpgradePhase> }) {
  const { t } = useTranslation("dashboard");
  const activeIndex = AGENT_UPGRADE_TIMELINE_PHASES.indexOf(phase as any);

  return (
    <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label={t("versionManagement.progress.title")}>
      {AGENT_UPGRADE_TIMELINE_PHASES.map((step, index) => {
        const terminalComplete = phase === "completed";
        const complete = activeIndex >= 0 && (index < activeIndex || terminalComplete);
        const active = !terminalComplete && index === activeIndex;
        return (
          <li key={step} className={cn(
            "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] font-bold",
            complete && "border-emerald-200 bg-emerald-50 text-emerald-700",
            active && "border-blue-300 bg-blue-50 text-blue-700",
            !complete && !active && "border-outline bg-surface-muted text-content-muted"
          )} aria-current={active ? "step" : undefined}>
            <span className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
              complete && "border-emerald-500 bg-emerald-500 text-white",
              active && "border-blue-500 bg-blue-500 text-white",
              !complete && !active && "border-outline-strong bg-surface text-content-muted"
            )}>
              {complete ? <Check className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : index + 1}
            </span>
            <span className="truncate">{t(`versionManagement.phases.${step}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailMetric({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: "slate" | "green" | "amber" | "red" }) {
  const toneClass = {
    slate: "text-content bg-surface-muted border-outline",
    green: "text-emerald-700 bg-emerald-50 border-emerald-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
    red: "text-red-700 bg-red-50 border-red-100"
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <div className="text-[12px] font-bold text-content-muted mb-1">{label}</div>
      <div className="text-sm font-black truncate">{value}</div>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="px-4 py-3 grid grid-cols-[120px_1fr] gap-3 text-[13px]">
      <span className="text-content-muted font-bold">{label}</span>
      <span className={cn("text-content-secondary font-semibold break-all", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
