import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown, Clock3, ExternalLink, Search, Sparkles, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatRunMetrics } from "./useChatRuns";
import { isTerminalRunStatus, parseTimeMs, shouldScheduleAutoCollapse } from "./runUiLifecycle";
import { formatLocalizedDuration } from "./localizedDuration";

export type ChatToolStepStatus = "running" | "completed" | "failed";
export type ChatToolStepType = "web_search" | "file_read" | "tool_call" | "model_reasoning" | "final";

export interface ChatToolStep {
  id: string;
  name: string;
  status: ChatToolStepStatus;
  completionInferred?: boolean;
  stepType?: ChatToolStepType;
  title?: string;
  safe_summary?: string;
  tool_name?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, any>;
  input?: string;
  output?: string;
}

interface ChatToolProgressProps {
  toolSteps: ChatToolStep[];
  agentName: string;
  runMetrics?: ChatRunMetrics | null;
}

const TOOL_STEP_EVENT_KEYS: Record<string, string> = {
  "agent task queued": "toolStepAgentTaskQueued",
  "deployment worker claimed the agent task": "toolStepDeploymentWorkerClaimed",
  "connecting to hermes agent runtime": "toolStepConnectingRuntime",
  "connecting to hermesagent runtime": "toolStepConnectingRuntime",
  "connecting to agent runtime": "toolStepConnectingRuntime",
  "connected to hermes agent runtime": "toolStepConnectedRuntime",
  "connected to hermesagent runtime": "toolStepConnectedRuntime",
  "connected to agent runtime": "toolStepConnectedRuntime",
  "agent is processing the request": "toolStepAgentProcessing",
  "task step completed": "toolStepCompleted",
  "task step failed": "toolStepFailed",
  "executing task step": "toolStepExecuting",
  "running task step": "toolStepRunning",
  "final answer generated": "toolStepFinalGenerated",
  "generating final answer": "toolStepFinalGenerating",
  "agent run ended": "toolStepFinalGenerated",
  "reasoning completed": "toolStepReasoningCompleted",
  "analyzing task context": "toolStepReasoningAnalyzing",
  "search completed": "toolStepSearchCompleted",
  "searching sources": "toolStepSearchRunning",
  "web page inspected": "toolStepBrowserCompleted",
  "inspecting web page": "toolStepBrowserRunning",
  "file processing completed": "toolStepFileCompleted",
  "reading file content": "toolStepFileRunning",
  "code execution completed": "toolStepCodeCompleted",
  "running code or command": "toolStepCodeRunning",
  "data processing completed": "toolStepDataCompleted",
  "processing data": "toolStepDataRunning",
  "communication step completed": "toolStepCommunicationCompleted",
  "preparing communication step": "toolStepCommunicationRunning"
};

function stringifyDetailValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyDetailValue(item)).filter(Boolean).join(", ");
  return "";
}

function pickDetailValue(step: ChatToolStep, keys: string[]): string {
  const metadata = step.metadata || {};
  for (const key of keys) {
    const value = stringifyDetailValue((metadata as any)[key] ?? (step as any)[key]);
    if (value) return value;
  }
  return "";
}

function compactDetail(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}


function getStepDuration(step: ChatToolStep, now: number): number | null {
  if (typeof step.startedAt !== "number" || !Number.isFinite(step.startedAt)) return null;
  const end = typeof step.completedAt === "number" && Number.isFinite(step.completedAt) ? step.completedAt : now;
  return Math.max(0, end - step.startedAt);
}
export function ChatToolProgress({ toolSteps, agentName, runMetrics = null }: ChatToolProgressProps) {
  const { t } = useTranslation("dashboard");
  const formatDuration = (value?: number | null) => formatLocalizedDuration(value, unit => t(`chatWorkspace.timelineDurationUnits.${unit}`), { fractionalSeconds: true }) || "-";
  const [showDetails, setShowDetails] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const terminal = isTerminalRunStatus(runMetrics?.status);
  useEffect(() => {
    setIsCollapsed(false);
    setShowDetails(false);
  }, [runMetrics?.runId]);
  useEffect(() => {
    if (shouldScheduleAutoCollapse(runMetrics)) {
      const timer = window.setTimeout(() => setIsCollapsed(true), 900);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runMetrics]);

  const completedCount = useMemo(
    () => toolSteps.filter((step) => step.status === "completed").length,
    [toolSteps]
  );

  const failedCount = useMemo(
    () => toolSteps.filter((step) => step.status === "failed").length,
    [toolSteps]
  );

  const activeStep = useMemo(() => {
    return [...toolSteps].reverse().find((step) => step.status === "running") || toolSteps[toolSteps.length - 1] || null;
  }, [toolSteps]);

  const overallDuration = runMetrics?.durationMs ?? (parseTimeMs(runMetrics?.startedAt) !== null ? Math.max(0, (terminal ? (parseTimeMs(runMetrics?.completedAt) || now) : now) - (parseTimeMs(runMetrics?.startedAt) || now)) : null);

  const visibleSteps = useMemo(() => {
    if (showDetails) return toolSteps;
    return activeStep ? [activeStep] : [];
  }, [activeStep, showDetails, toolSteps]);

  const translateToolStepKey = (key: string) => {
    return t("dashboard:chatWorkspace." + key);
  };

  const getToolStepLabel = (step: ChatToolStep) => {
    const raw = String(step.name || "").trim();
    const normalized = raw.toLowerCase();

    const fixedEventKey = TOOL_STEP_EVENT_KEYS[normalized];
    if (fixedEventKey) {
      return translateToolStepKey(fixedEventKey);
    }
    if (normalized.startsWith("chatworkspace.")) {
      return translateToolStepKey(raw.slice("chatWorkspace.".length));
    }
    if (!raw) {
      const fallbackRaw = String(step.title || step.safe_summary || "").trim();
      if (fallbackRaw.toLowerCase().startsWith("chatworkspace.")) {
        return translateToolStepKey(fallbackRaw.slice("chatWorkspace.".length));
      }
      return fallbackRaw || t("chatWorkspace.toolCategoryGeneric");
    }
    if (normalized === "browser" || normalized.includes("browser") || normalized.includes("webpage")) {
      return t("chatWorkspace.toolCategoryBrowser");
    }
    if (normalized.includes("search")) {
      return t("chatWorkspace.toolCategorySearch");
    }
    if (normalized.includes("file")) {
      return t("chatWorkspace.toolCategoryFile");
    }
    if (normalized.includes("terminal") || normalized.includes("command") || normalized.includes("shell")) {
      return t("chatWorkspace.toolCategoryTerminal");
    }
    return raw.length > 72 ? `${raw.slice(0, 72)}...` : raw;
  };

  const getToolStepDetails = (step: ChatToolStep) => {
    const items: Array<{ icon: typeof Search; label: string; value: string; href?: string }> = [];
    const query = pickDetailValue(step, ["query", "search_query", "keyword", "keywords"]);
    const source = pickDetailValue(step, ["source", "provider", "engine", "site", "domain"]);
    const url = pickDetailValue(step, ["url", "href", "link", "page_url"]);
    const pageTitle = pickDetailValue(step, ["page_title", "title_text"]);
    const filePath = pickDetailValue(step, ["file", "file_path", "path", "filename"]);
    const count = pickDetailValue(step, ["count", "result_count", "results_count", "items_count"]);
    const toolName = String(step.tool_name || "").trim();

    if (query) items.push({ icon: Search, label: t("chatWorkspace.toolDetailQuery"), value: compactDetail(query, 120) });
    if (url && /^https?:\/\//i.test(url)) items.push({ icon: ExternalLink, label: t("chatWorkspace.toolDetailUrl"), value: compactDetail(pageTitle ? `${pageTitle} · ${url}` : url, 120), href: url });
    if (filePath) items.push({ icon: Wrench, label: t("chatWorkspace.toolDetailFile"), value: compactDetail(filePath, 120) });
    if (source) items.push({ icon: Wrench, label: t("chatWorkspace.toolDetailSource"), value: compactDetail(source, 80) });
    if (count) items.push({ icon: Wrench, label: t("chatWorkspace.toolDetailCount"), value: count });
    if (toolName && !["search", "browser", "file", "code", "data", "communication", "other"].includes(toolName)) {
      items.push({ icon: Wrench, label: t("chatWorkspace.toolDetailTool"), value: compactDetail(toolName, 80) });
    }

    return items.slice(0, 4);
  };

  if (toolSteps.length === 0) return null;

  return (
    <div className="max-w-3xl mx-auto w-full rounded-2xl border border-indigo-100/80 bg-surface/95 px-3.5 py-3 text-[13px] shadow-sm animate-fade-in select-none dark:border-indigo-400/20 dark:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30">
            <Sparkles className="w-3.5 h-3.5 motion-safe:animate-pulse" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-slate-700 dark:text-slate-100">{t("chatWorkspace.agentOperating", { name: agentName })}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-content-muted"><Clock3 className="h-3 w-3" />{formatDuration(overallDuration)}</div>
            <div className="mt-0.5 text-[13px] text-content-muted truncate">
              {failedCount > 0
                ? t("chatWorkspace.toolStepsFailed", { count: failedCount })
                : completedCount > 0
                  ? t("chatWorkspace.toolStepsCompleted", { count: completedCount })
                  : t("chatWorkspace.toolStepsPreparing")}
            </div>
          </div>
        </div>        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={() => setIsCollapsed((value) => !value)} className="inline-flex items-center gap-1 rounded-lg border border-outline bg-surface-muted px-2.5 py-1 text-[13px] font-medium text-slate-500 hover:bg-surface-muted hover:text-slate-700 transition-colors dark:text-slate-300 dark:hover:text-slate-100">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
            {isCollapsed ? t("chatWorkspace.toolExpand") : t("chatWorkspace.toolCollapse")}
          </button>
          {!isCollapsed && toolSteps.length > 1 && (
            <button type="button" onClick={() => setShowDetails((value) => !value)} className="shrink-0 rounded-lg border border-outline bg-surface-muted px-2.5 py-1 text-[13px] font-medium text-slate-500 hover:bg-surface-muted hover:text-slate-700 transition-colors dark:text-slate-300 dark:hover:text-slate-100">
              {showDetails ? t("chatWorkspace.toolHideDetails") : t("chatWorkspace.toolViewDetails")}
            </button>
          )}
        </div>
      </div>

      <div className={isCollapsed ? "hidden" : "mt-3 space-y-1.5"}>
        {visibleSteps.map((step) => {
          const details = getToolStepDetails(step);
          return (
            <div key={step.id} className="rounded-xl bg-surface-muted/80 px-3 py-2">
              <div className="flex items-center gap-2">
                {step.status === "running" ? (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
                  </span>
                ) : step.status === "completed" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-700 dark:text-slate-100">{getToolStepLabel(step)}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${step.status === "running" ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" : step.status === "completed" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                  {step.status === "running" ? t("chatWorkspace.toolRunning") : step.status === "completed" ? t("chatWorkspace.toolCompleted") : t("chatWorkspace.toolFailed")}
                </span>
                {getStepDuration(step, now) !== null && (<span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-content-muted"><Clock3 className="h-3 w-3" />{formatDuration(getStepDuration(step, now))}</span>)}
              </div>
              {details.length > 0 && (
                <div className="mt-1.5 space-y-1 pl-4">
                  {details.map((item, index) => {
                    const Icon = item.icon;
                    const content = (
                      <span className="truncate">
                        <span className="text-content-muted">{item.label}</span>
                        <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                        <span className="text-content-secondary">{item.value}</span>
                      </span>
                    );
                    return item.href ? (
                      <a key={`${item.label}-${index}`} href={item.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] hover:text-indigo-600 dark:hover:text-indigo-300 min-w-0">
                        <Icon className="h-3 w-3 shrink-0 text-slate-400" />
                        {content}
                      </a>
                    ) : (
                      <div key={`${item.label}-${index}`} className="flex items-center gap-1.5 text-[11px] min-w-0">
                        <Icon className="h-3 w-3 shrink-0 text-slate-400" />
                        {content}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
