import { Bug, Clock3, Database, FileJson, TerminalSquare } from "lucide-react";
import type { TFunction } from "i18next";
import type { ChatToolStep } from "../ChatToolProgress";
import type { ChatRunMetrics } from "../useChatRuns";

type WorkspaceDebugTabProps = {
  t: TFunction;
  toolSteps: ChatToolStep[];
  runMetrics: ChatRunMetrics;
  activeRunId?: string | null;
  getTimelineLabel: (step: ChatToolStep) => string;
  getTimelineStatusLabel: (step: ChatToolStep) => string;
  getTimelineStepTypeLabel: (step: ChatToolStep) => string;
  formatTimelineTime: (value?: number) => string;
};

const formatMetricValue = (value?: string | number | null) => (
  value === undefined || value === null || value === "" ? "-" : String(value)
);

const safePreview = (value?: string) => {
  if (!value) return "";
  return value.length > 1200 ? value.slice(0, 1200) + "..." : value;
};

export function WorkspaceDebugTab({
  t,
  toolSteps,
  runMetrics,
  activeRunId,
  getTimelineLabel,
  getTimelineStatusLabel,
  getTimelineStepTypeLabel,
  formatTimelineTime
}: WorkspaceDebugTabProps) {
  const debugSteps = toolSteps.filter((step) => step.input || step.output || step.metadata || step.tool_name);

  const formatRunStatus = (value?: string | null) => {
    const normalized = String(value || "").toLowerCase();
    if (!normalized) return "-";
    if (normalized === "completed") return t("dashboard:chatWorkspace.toolCompleted");
    if (normalized === "running" || normalized === "queued" || normalized === "dispatching") return t("dashboard:chatWorkspace.toolRunning");
    if (normalized === "failed" || normalized === "cancelled" || normalized === "expired") return t("dashboard:chatWorkspace.toolFailed");
    return value || "-";
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600 dark:border-indigo-400/25 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Bug className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-content">
              {t("dashboard:chatWorkspace.debugTitle")}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-content-muted">
              {t("dashboard:chatWorkspace.debugDesc")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-slate-400">{t("dashboard:chatWorkspace.debugRunId")}</span>
            <p className="mt-1 truncate font-mono text-content-secondary">{formatMetricValue(runMetrics.runId || activeRunId)}</p>
          </div>
          <div className="rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-slate-400">{t("dashboard:chatWorkspace.debugStatus")}</span>
            <p className="mt-1 font-mono text-content-secondary">{formatRunStatus(runMetrics.status)}</p>
          </div>
          <div className="rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-slate-400">{t("dashboard:chatWorkspace.debugDuration")}</span>
            <p className="mt-1 font-mono text-content-secondary">{formatMetricValue(runMetrics.durationMs)} ms</p>
          </div>
          <div className="rounded-lg bg-surface-muted px-2.5 py-2">
            <span className="text-slate-400">{t("dashboard:chatWorkspace.debugTokens")}</span>
            <p className="mt-1 font-mono text-content-secondary">{formatMetricValue(runMetrics.usageTotalTokens)}</p>
          </div>
        </div>
      </div>

      {debugSteps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline bg-surface/70 px-4 py-8 text-center">
          <FileJson className="mx-auto mb-3 h-5 w-5 text-slate-400" />
          <p className="text-[13px] font-semibold text-content">
            {t("dashboard:chatWorkspace.debugEmptyTitle")}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-content-muted">
            {t("dashboard:chatWorkspace.debugEmptyDesc")}
          </p>
        </div>
      ) : (
        debugSteps.map((step) => (
          <div key={step.id} className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-content">{getTimelineLabel(step)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-content-muted">
                  <span>{getTimelineStepTypeLabel(step)}</span>
                  <span>{getTimelineStatusLabel(step)}</span>
                  {(step.completedAt || step.startedAt) && (
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatTimelineTime(step.completedAt || step.startedAt)}</span>
                  )}
                </div>
              </div>
              <TerminalSquare className="h-4 w-4 shrink-0 text-slate-400" />
            </div>

            {step.tool_name && (
              <div className="mb-2 rounded-lg bg-surface-muted px-2.5 py-2 text-[12px]">
                <span className="text-slate-400">{t("dashboard:chatWorkspace.debugTool")}</span>
                <p className="mt-1 font-mono text-content-secondary">{step.tool_name}</p>
              </div>
            )}
            {step.metadata && Object.keys(step.metadata).length > 0 && (
              <div className="mb-2 rounded-lg bg-surface-muted px-2.5 py-2 text-[12px]">
                <div className="mb-1 flex items-center gap-1.5 text-slate-400"><Database className="h-3.5 w-3.5" />{t("dashboard:chatWorkspace.debugMetadata")}</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-content-secondary">{JSON.stringify(step.metadata, null, 2)}</pre>
              </div>
            )}
            {step.input && (
              <div className="mb-2 rounded-lg bg-surface-muted px-2.5 py-2 text-[12px]">
                <span className="text-slate-400">{t("dashboard:chatWorkspace.debugInput")}</span>
                <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-content-secondary">{safePreview(step.input)}</pre>
              </div>
            )}
            {step.output && (
              <div className="rounded-lg bg-surface-muted px-2.5 py-2 text-[12px]">
                <span className="text-slate-400">{t("dashboard:chatWorkspace.debugOutput")}</span>
                <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-content-secondary">{safePreview(step.output)}</pre>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
