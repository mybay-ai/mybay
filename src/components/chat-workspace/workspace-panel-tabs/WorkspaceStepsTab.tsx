import { Clock3, Loader2, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { ChatToolStep } from "../ChatToolProgress";

type TimelineFilter = "all" | "tool" | "search" | "file" | "model" | "failed";

type WorkspaceStepsTabProps = {
  t: TFunction;
  runningToolCount: number;
  completedToolCount: number;
  toolSteps: ChatToolStep[];
  filteredToolSteps: ChatToolStep[];
  timelineFilters: Array<{ id: TimelineFilter; label: string }>;
  timelineFilter: TimelineFilter;
  setTimelineFilter: Dispatch<SetStateAction<TimelineFilter>>;
  hasActiveRunWithoutSteps: boolean;
  getTimelineIcon: (step: ChatToolStep) => LucideIcon;
  getTimelineLabel: (step: ChatToolStep) => string;
  getTimelineStatusLabel: (step: ChatToolStep) => string;
  getTimelineStepTypeLabel: (step: ChatToolStep) => string;
  formatTimelineTime: (value?: number) => string;
};

export function WorkspaceStepsTab({
  t,
  runningToolCount,
  completedToolCount,
  toolSteps,
  filteredToolSteps,
  timelineFilters,
  timelineFilter,
  setTimelineFilter,
  hasActiveRunWithoutSteps,
  getTimelineIcon,
  getTimelineLabel,
  getTimelineStatusLabel,
  getTimelineStepTypeLabel,
  formatTimelineTime
}: WorkspaceStepsTabProps) {
  return (
          <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.timelineTitle")}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-content-muted">
                  {t("dashboard:chatWorkspace.timelineDesc")}
                </p>
              </div>
              {(runningToolCount > 0 || completedToolCount > 0) && (
                <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-content-muted">
                  {t("dashboard:chatWorkspace.workspaceStepStats", { running: runningToolCount, completed: completedToolCount })}
                </span>
              )}
            </div>

            {toolSteps.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-surface-muted/80 p-1">
                {timelineFilters.map((filter) => {
                  const active = timelineFilter === filter.id;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setTimelineFilter(filter.id)}
                      className={"rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors " + (
                        active
                          ? "bg-surface text-content shadow-xs"
                          : "text-content-muted hover:bg-surface/70 hover:text-content"
                      )}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
            )}

            {toolSteps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline bg-surface-muted/70 px-4 py-8 text-center">
                <Clock3 className="mx-auto mb-3 h-5 w-5 text-slate-400" />
                <p className="text-[13px] font-semibold text-content">
                  {hasActiveRunWithoutSteps
                    ? t("dashboard:chatWorkspace.timelineConnectingTitle")
                    : t("dashboard:chatWorkspace.timelineEmptyTitle")}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-content-muted">
                  {hasActiveRunWithoutSteps
                    ? t("dashboard:chatWorkspace.timelineConnectingDesc")
                    : t("dashboard:chatWorkspace.timelineEmptyDesc")}
                </p>
              </div>
            ) : filteredToolSteps.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline bg-surface-muted/70 px-4 py-8 text-center">
                <Search className="mx-auto mb-3 h-5 w-5 text-slate-400" />
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.timelineFilterEmptyTitle")}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-content-muted">
                  {t("dashboard:chatWorkspace.timelineFilterEmptyDesc")}
                </p>
              </div>
            ) : (
              <div className="relative space-y-3 before:absolute before:left-[17px] before:top-4 before:bottom-4 before:w-px before:bg-outline">
                {filteredToolSteps.map((step) => {
                  const Icon = getTimelineIcon(step);
                  const timeLabel = formatTimelineTime(step.completedAt || step.startedAt);
                  return (
                    <div key={step.id} className="relative flex gap-3">
                      <div className={"relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border " + (
                        step.status === "running"
                          ? "border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-300"
                          : step.status === "completed"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-400/25 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-400/25 dark:bg-rose-500/15 dark:text-rose-300"
                      )}>
                        {step.status === "running" ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1 rounded-xl border border-outline/80 bg-surface-muted/80 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 text-[13px] font-semibold leading-5 text-content">
                            {getTimelineLabel(step)}
                          </p>
                          <span className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " + (
                            step.status === "running"
                              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                              : step.status === "completed"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                          )}>
                            {getTimelineStatusLabel(step)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-content-muted">
                          <span>{getTimelineStepTypeLabel(step)}</span>
                          {timeLabel && <span>{timeLabel}</span>}
                          {typeof step.metadata?.count === "number" && (
                            <span>{t("dashboard:chatWorkspace.timelineCount", { count: step.metadata.count })}</span>
                          )}
                        </div>
                        {typeof step.metadata?.query === "string" && (
                          <p className="mt-2 line-clamp-2 rounded-lg bg-surface px-2 py-1.5 text-[12px] leading-5 text-content-secondary">
                            {step.metadata.query}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        
  );
}
