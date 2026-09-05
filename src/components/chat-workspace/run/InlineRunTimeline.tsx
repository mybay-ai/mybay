import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, CircleHelp, CircleStop, LoaderCircle, ShieldQuestion, Wrench, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatRunMetrics } from "../useChatRuns";
import type { RunBlock, RunExecutionState, ToolRunBlock } from "./runTypes";
import { isTerminalExecutionStatus } from "./runReducer";
import { resolveRunDurationMs } from "./runDuration";
import { translateToolStepLabel } from "./toolStepI18n";
import { getRunStatusI18nKey, getToolStatusI18nKey, resolveRunDisplayStatus, resolveToolDisplayStatus } from "./runStatusSemantics";
import { safeLocalEvidencePath } from "../../../../shared/localRunFileEvidence";
import { formatLocalizedDuration, type LocalizedDurationUnit } from "../localizedDuration";


export const formatTimelineDuration = (durationMs: number | null, unit: (key: LocalizedDurationUnit) => string) => formatLocalizedDuration(durationMs, unit);


function ToolBlock({ block, execution }: { block: ToolRunBlock; execution: RunExecutionState }) {
  const { t } = useTranslation("dashboard");
  const runStatus = resolveRunDisplayStatus({ executionRunId: execution.runId, executionStatus: execution.status });
  const displayStatus = resolveToolDisplayStatus(block.status, runStatus, block.completionInferred);
  const Icon = displayStatus === "running" || displayStatus === "waiting_for_approval" ? LoaderCircle : displayStatus === "completed" ? CheckCircle2 : displayStatus === "unknown" ? CircleHelp : displayStatus === "stopped" ? CircleStop : XCircle;
  const statusLabel = t(`chatWorkspace.${getToolStatusI18nKey(displayStatus)}`);
  const iconClass = "mt-0.5 h-3.5 w-3.5 shrink-0 " + (
    displayStatus === "running" ? "animate-spin text-indigo-500" :
      displayStatus === "waiting_for_approval" ? "text-amber-500" :
        displayStatus === "completed" ? "text-emerald-500" :
          displayStatus === "stopped" || displayStatus === "unknown" ? "text-amber-500" : "text-rose-500"
  );
  return (
    <div className="flex items-start gap-2 rounded-xl border border-outline/80 bg-surface-muted/55 px-3 py-2 text-[12px]">
      <Icon className={iconClass} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-content">{block.completionInferred ? t("chatWorkspace.timelineGenericStep") : translateToolStepLabel(t, block.label || block.tool, block.tool)}</div>
        {safeLocalEvidencePath(block.metadata?.file_path) && <div className="break-all font-mono text-content-muted">{String(block.metadata?.file_path)}</div>}
        <div className="text-content-muted">{statusLabel}</div>
      </div>
    </div>
  );
}

function TimelineBlock({ block, execution, renderText }: { block: RunBlock; execution: RunExecutionState; renderText?: (content: string) => ReactNode }) {
  const { t } = useTranslation("dashboard");
  if (block.type === "text") return <div className="px-1 text-[14px]" data-timeline-text>{renderText ? renderText(block.content) : block.content}</div>;
  if (block.type === "tool") return <ToolBlock block={block} execution={execution} />;
  if (block.type === "approval") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <ShieldQuestion className="h-4 w-4" />
        {block.status === "pending"
          ? t("chatWorkspace.timelineApprovalPending")
          : block.status === "expired"
            ? t("chatWorkspace.timelineApprovalExpired")
            : t("chatWorkspace.timelineApprovalResolved")}
      </div>
    );
  }
  if (block.type === "status") {
    if (!isTerminalExecutionStatus(block.status)) return <div className="px-1 text-[12px] text-content-muted">{t(`chatWorkspace.${getRunStatusI18nKey(resolveRunDisplayStatus({ executionStatus: block.status }))}`)}</div>;
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-content-muted">
        {block.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <CircleStop className="h-3.5 w-3.5 text-amber-500" />}
        {block.status === "completed"
          ? t("chatWorkspace.timelineRunCompleted")
          : block.status === "stopped" || block.status === "cancelled"
            ? t("chatWorkspace.timelineRunStopped")
            : t("chatWorkspace.timelineRunFailed")}
      </div>
    );
  }
  return null;
}

function CompletedToolGroup({ blocks, execution }: { blocks: ToolRunBlock[]; execution: RunExecutionState }) {
  const { t } = useTranslation('dashboard');
  const [expanded, setExpanded] = useState(false);
  return <div className="space-y-1">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 rounded-lg bg-surface-muted/50 px-3 py-1.5 text-left text-xs text-content-secondary">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span className="min-w-0 flex-1">{t('chatWorkspace.completedToolGroup', { count: blocks.length })}</span>
      {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
    {expanded && blocks.map(block => <ToolBlock key={block.id} block={block} execution={execution} />)}
  </div>;
}

// Only group consecutive, confirmed successes. Narration and steps requiring
// attention remain in place and are never hidden inside a success summary.
export function groupTimelineBlocks(blocks: RunBlock[]): (RunBlock | ToolRunBlock[])[] {
  const rows: (RunBlock | ToolRunBlock[])[] = [];
  let completed: ToolRunBlock[] = [];
  const flush = () => { if (completed.length > 3) rows.push(completed); else rows.push(...completed); completed = []; };
  for (const block of blocks) {
    if (block.type === 'tool' && block.status === 'completed' && !block.completionInferred) completed.push(block);
    else { flush(); rows.push(block); }
  }
  flush();
  return rows;
}

export function InlineRunTimeline({
  execution,
  metrics,
  hideApprovalBlocks = false,
  renderText,
  textUnaligned = false,
}: { execution: RunExecutionState; metrics?: ChatRunMetrics | null; hideApprovalBlocks?: boolean;
  renderText?: (content: string) => ReactNode; textUnaligned?: boolean }) {
  const { t } = useTranslation("dashboard");
  const terminal = isTerminalExecutionStatus(execution.status);
  const [choice, setChoice] = useState<{ runId: string; collapsed: boolean } | null>(null);
  const collapsed = choice?.runId === execution.runId ? choice.collapsed : terminal;
  const [now, setNow] = useState(Date.now());
  const visibleBlocks = useMemo(() => execution.blocks.filter(block => !hideApprovalBlocks || block.type !== "approval"), [execution.blocks, hideApprovalBlocks]);
  const rows = useMemo(() => groupTimelineBlocks(visibleBlocks), [visibleBlocks]);
  const stepCount = execution.blocks.filter(block => block.type === "tool").length;
  const archivedWithoutDuration = terminal && execution.timelinePartial !== undefined && metrics?.durationMs == null;
  const duration = archivedWithoutDuration ? "" : formatTimelineDuration(resolveRunDurationMs({
    metrics,
    startCandidates: execution.blocks.filter((block): block is ToolRunBlock => block.type === "tool").map(block => block.startedAt),
    completedCandidates: execution.blocks.filter((block): block is ToolRunBlock => block.type === "tool" && !block.completionInferred).map(block => block.completedAt),
    active: !terminal,
    nowMs: now
  }), unit => t(`chatWorkspace.timelineDurationUnits.${unit}`));
  const runDisplayStatus = resolveRunDisplayStatus({ executionRunId: execution.runId, executionStatus: execution.status });
  const statusLabel = t(`chatWorkspace.${getRunStatusI18nKey(runDisplayStatus)}`);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);

  return (
    <div className="mb-3 space-y-2.5 border-b border-outline pb-3" data-run-id={execution.runId}>
      <button type="button" aria-expanded={!collapsed} onClick={() => setChoice({ runId: execution.runId, collapsed: !collapsed })} className="flex w-full items-center gap-2 rounded-xl bg-surface-muted/70 px-3 py-2 text-left text-[12px] font-medium text-content-secondary hover:bg-surface-muted">
        {terminal ? <Wrench className="h-3.5 w-3.5 text-content-muted" /> : <LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
        <span className="min-w-0 flex-1 truncate">{[t("chatWorkspace.timelineTitle"), statusLabel, stepCount + " " + t("chatWorkspace.timelineSteps"), duration].filter(Boolean).join(" · ")}</span>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {(execution.timelinePartial || textUnaligned) && <p className="m-0 text-[12px] text-content-muted">{t("chatWorkspace.timelinePartialNotice")}</p>}
      {!collapsed && visibleBlocks.length > 0 && (
        <div className="space-y-2">{rows.map(row => Array.isArray(row)
          ? <CompletedToolGroup key={row[0].id} blocks={row} execution={execution} />
          : <TimelineBlock key={row.id} block={row} execution={execution} renderText={renderText} />)}</div>
      )}
    </div>
  );
}
