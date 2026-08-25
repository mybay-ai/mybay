import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bug, Clock3, FileText, FolderOpen, Image, Layers, Search, Sparkles, Wrench } from "lucide-react";
import type { AgentInstance } from "../../types";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import type { ChatToolStep } from "./ChatToolProgress";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "./useChatRuns";
import { sanitizeChatDisplayContent } from "../../lib/chatProtocolSanitizer";
import { WorkspaceDebugTab, WorkspaceFilesTab, WorkspacePreviewTab, WorkspaceResultTab, WorkspaceStepsTab } from "./workspace-panel-tabs";
import { resolveRunDurationMs } from "./run/runDuration";
import type { RunExecutionState } from "./run/runTypes";
import { resolveWorkspaceAssistantResult } from "./run/runResultSource";
import { getRunStatusI18nKey, getToolStatusI18nKey, isTerminalRunDisplayStatus, resolveRunDisplayStatus, resolveToolDisplayStatus, type ToolDisplayStatus } from "./run/runStatusSemantics";

type WorkspaceTab = "result" | "steps" | "files" | "preview" | "debug";
type TimelineFilter = "all" | "tool" | "search" | "file" | "model" | "failed";

import type { PendingAttachment } from "./ChatInputBar";
import type { ConversationFilePreview } from "./useChatWorkspaceFiles";
type ChatWorkspacePanelProps = {
  selectedId?: string;
  selectedConversationId?: string | null;
  conversationFiles?: PendingAttachment[];
  conversationFilePreview?: ConversationFilePreview | null;
  onDeleteConversationFile?: (fileId: string) => void;
  onDownloadConversationFile?: (file: PendingAttachment) => void;
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onPreviewConversationFile?: (file: PendingAttachment) => void;
  onClearConversationFilePreview?: () => void;
  selectedInstance?: AgentInstance;
  messages: ChatMessage[];
  toolSteps: ChatToolStep[];
  activeRunId?: string | null;
  runExecutionState?: RunExecutionState | null;
  runMetrics?: ChatRunMetrics | null;
  approvalRequests?: ChatApprovalRequest[];
  runCapabilities?: {
    approvalEvents: boolean;
    runApprovalResponse: boolean;
    runStop: boolean;
    runEventsSse: boolean;
    toolProgressEvents: boolean;
  };
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void;
  variant?: "desktop" | "mobile";
};

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

const STEP_TYPE_LABEL_KEYS: Record<string, string> = {
  web_search: "toolCategorySearch",
  file_read: "toolCategoryFile",
  tool_call: "toolCategoryGeneric",
  model_reasoning: "toolStepModelReasoning",
  final: "toolStepFinal"
};

const tabIcons: Record<WorkspaceTab, typeof Sparkles> = {
  result: Sparkles,
  steps: Clock3,
  files: FolderOpen,
  preview: Image,
  debug: Bug
};

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;

const extractUrlsFromText = (content: string) => {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of content.matchAll(URL_PATTERN)) {
    const rawUrl = match[0].replace(/(?:[*_`]+|[\])}>),.;:!?，。；：！？]+)+$/gu, "");
    const normalizedUrl = rawUrl.startsWith("www.") ? "https://" + rawUrl : rawUrl;
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
    }
  }
  return urls;
};

export function ChatWorkspacePanel({ selectedId, selectedConversationId, selectedInstance, messages, toolSteps, activeRunId, runExecutionState = null, runMetrics = null, approvalRequests = [], runCapabilities, onRespondToApproval, variant = "desktop", conversationFiles = [], conversationFilePreview = null, onDeleteConversationFile, onDownloadConversationFile, onOpenConversationFile, onPreviewConversationFile, onClearConversationFilePreview }: ChatWorkspacePanelProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("result");
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null);
  const [durationNowMs, setDurationNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (conversationFilePreview) {
      setActiveTab("preview");
    }
  }, [conversationFilePreview]);

  const runDisplayStatus = resolveRunDisplayStatus({
    activeRunId,
    executionRunId: runExecutionState?.runId,
    executionStatus: runExecutionState?.status,
    metricRunId: runMetrics?.runId,
    metricStatus: runMetrics?.status,
    hasPendingApproval: approvalRequests.some(request => request.status === "pending"),
    hasRunningTool: toolSteps.some(step => step.status === "running")
  });
  const runStatusLabel = t(`dashboard:chatWorkspace.${getRunStatusI18nKey(runDisplayStatus)}`);
  const runIsActive = Boolean(activeRunId && !isTerminalRunDisplayStatus(runDisplayStatus));
  useEffect(() => {
    setDurationNowMs(Date.now());
    if (!runIsActive) return;
    const timerId = window.setInterval(() => setDurationNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [activeRunId, runIsActive]);

  const assistantResult = useMemo(
    () => resolveWorkspaceAssistantResult(messages, runExecutionState, activeRunId),
    [activeRunId, messages, runExecutionState]
  );
  const latestAssistantMessage = assistantResult.message;
  const latestAssistantContent = sanitizeChatDisplayContent(
    assistantResult.content,
    t("dashboard:chatWorkspace.toolCallProtocolHidden")
  );

  const getTimelineDisplayStatus = (step: ChatToolStep): ToolDisplayStatus => resolveToolDisplayStatus(step.status, runDisplayStatus);
  const completedToolCount = toolSteps.filter((step) => getTimelineDisplayStatus(step) === "completed").length;
  const failedToolCount = toolSteps.filter((step) => getTimelineDisplayStatus(step) === "failed").length;
  const hasActiveRunWithoutSteps = Boolean(activeRunId && toolSteps.length === 0);
  const runningToolCount = toolSteps.filter((step) => getTimelineDisplayStatus(step) === "running").length;
  const resolvedDurationMs = resolveRunDurationMs({
    metrics: runMetrics,
    startCandidates: toolSteps.map(step => step.startedAt),
    completedCandidates: toolSteps.map(step => step.completedAt),
    active: runIsActive,
    nowMs: durationNowMs
  });
  const effectiveRunMetrics: ChatRunMetrics = {
    ...runMetrics,
    status: runDisplayStatus === "idle" ? runMetrics?.status : runDisplayStatus,
    durationMs: resolvedDurationMs
  };
  const totalToolCallCount = toolSteps.filter((step) => step.stepType !== "model_reasoning" && step.stepType !== "final").length;
  const latestAssistantUrls = useMemo(() => extractUrlsFromText(latestAssistantContent).slice(0, 3), [latestAssistantContent]);
  const resultSummaryVisible = toolSteps.length > 0 || conversationFiles.length > 0 || latestAssistantUrls.length > 0;
  const instanceName = selectedInstance?.name?.trim() || t("dashboard:chatWorkspace.agentFallbackName");
  const pendingApproval = approvalRequests.find((item) => item.status === "pending");
  const latestApproval = approvalRequests[0];
  const canRespondToApproval = Boolean(runCapabilities?.runApprovalResponse && onRespondToApproval);
  const approvalChoiceLabels: Record<ChatApprovalChoice, string> = {
    once: t("dashboard:chatWorkspace.approvalChoiceOnce"),
    session: t("dashboard:chatWorkspace.approvalChoiceSession"),
    always: t("dashboard:chatWorkspace.approvalChoiceAlways"),
    deny: t("dashboard:chatWorkspace.approvalChoiceDeny")
  };
  const translateToolStepKey = (key: string) => {
    return t("dashboard:chatWorkspace." + key);
  };

  const getTimelineLabel = (step: ChatToolStep) => {
    const raw = String(step.title || step.safe_summary || step.name || "").trim();
    const fixedEventKey = TOOL_STEP_EVENT_KEYS[raw.toLowerCase()];
    if (fixedEventKey) {
      return translateToolStepKey(fixedEventKey);
    }
    if (raw.toLowerCase().startsWith("chatworkspace.")) {
      return translateToolStepKey(raw.slice("chatWorkspace.".length));
    }
    return raw || t("dashboard:chatWorkspace.timelineGenericStep");
  };

  const getTimelineStepTypeLabel = (step: ChatToolStep) => {
    const raw = String(step.stepType || "tool_call");
    const labelKey = STEP_TYPE_LABEL_KEYS[raw];
    return labelKey ? translateToolStepKey(labelKey) : raw;
  };

  const getTimelineIcon = (step: ChatToolStep) => {
    if (step.stepType === "web_search") return Search;
    if (step.stepType === "file_read") return FileText;
    if (step.stepType === "model_reasoning" || step.stepType === "final") return Sparkles;
    return Wrench;
  };

  const getTimelineStatusLabel = (step: ChatToolStep) => {
    return t(`dashboard:chatWorkspace.${getToolStatusI18nKey(getTimelineDisplayStatus(step))}`);
  };

  const getConversationFileSourceLabel = (file: PendingAttachment) => {
    const metadata = (file as PendingAttachment & { metadata?: Record<string, unknown> }).metadata;
    const source = metadata?.source || metadata?.sourceStepTitle || metadata?.toolName || metadata?.stepType;
    if (typeof source === "string" && source.trim()) return source.trim();
    return t("dashboard:chatWorkspace.workspaceFileSourceConversation");
  };

  const buildConversationFileLink = (file: PendingAttachment) => {
    if (!selectedId || !selectedConversationId || !file.id) return "";
    const downloadPath = "/api/instances/" + encodeURIComponent(selectedId) + "/conversations/" + encodeURIComponent(selectedConversationId) + "/files/" + encodeURIComponent(file.id) + "/download?disposition=inline";
    if (typeof window === "undefined") return downloadPath;
    return new URL(downloadPath, window.location.origin).toString();
  };

  const copyTextToClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  };

  const handleCopyConversationFileLink = async (file: PendingAttachment) => {
    const link = buildConversationFileLink(file);
    if (!link || typeof document === "undefined") return;
    try {
      await copyTextToClipboard(link);
      setCopiedFileId(file.id);
      window.setTimeout(() => {
        setCopiedFileId((current) => current === file.id ? null : current);
      }, 1500);
    } catch {
      setCopiedFileId(null);
    }
  };

  const formatTimelineTime = (value?: number) => {
    if (!value) return "";
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const getTimelineCategory = (step: ChatToolStep): Exclude<TimelineFilter, "all" | "failed"> => {
    const stepType = String(step.stepType || "tool_call").toLowerCase();
    const title = String(step.title || step.safe_summary || step.name || "").toLowerCase();
    const metadataCategory = String(step.metadata?.category || "").toLowerCase();
    const combined = stepType + " " + title + " " + metadataCategory;
    if (stepType === "web_search" || combined.includes("search") || combined.includes("搜索")) return "search";
    if (stepType === "file_read" || combined.includes("file") || combined.includes("文件")) return "file";
    if (stepType === "model_reasoning" || stepType === "final" || combined.includes("reasoning")) return "model";
    return "tool";
  };

  const filteredToolSteps = toolSteps.filter((step) => {
    if (timelineFilter === "all") return true;
    if (timelineFilter === "failed") return step.status === "failed";
    return getTimelineCategory(step) === timelineFilter;
  });

  const tabs: Array<{ id: WorkspaceTab; label: string }> = [
    { id: "result", label: t("dashboard:chatWorkspace.workspaceResultTab") },
    { id: "steps", label: t("dashboard:chatWorkspace.workspaceStepsTab") },
    { id: "files", label: t("dashboard:chatWorkspace.workspaceFilesTab") },
    { id: "preview", label: t("dashboard:chatWorkspace.workspacePreviewTab") },
    { id: "debug", label: t("dashboard:chatWorkspace.workspaceDebugTab") }
  ];

  const timelineFilters: Array<{ id: TimelineFilter; label: string }> = [
    { id: "all", label: t("dashboard:chatWorkspace.timelineFilterAll") },
    { id: "tool", label: t("dashboard:chatWorkspace.timelineFilterTool") },
    { id: "search", label: t("dashboard:chatWorkspace.timelineFilterSearch") },
    { id: "file", label: t("dashboard:chatWorkspace.timelineFilterFile") },
    { id: "model", label: t("dashboard:chatWorkspace.timelineFilterModel") },
    { id: "failed", label: t("dashboard:chatWorkspace.timelineFilterFailed") }
  ];

  const shellClassName = variant === "mobile"
    ? "flex h-full min-h-0 flex-col overflow-hidden bg-surface"
    : "hidden xl:flex w-[380px] 2xl:w-[430px] shrink-0 border-l border-outline/80 bg-surface-muted/70 backdrop-blur-sm min-h-0 flex-col";

  return (
    <aside className={shellClassName}>
      <div className="shrink-0 px-4 py-3 border-b border-outline/80 bg-surface/85">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/30">
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-content truncate">
                  {t("dashboard:chatWorkspace.workspaceTitle")}
                </h2>
                <p className="text-[13px] text-content-muted truncate">
                  {t("dashboard:chatWorkspace.workspaceSubtitle", { name: instanceName })}
                </p>
              </div>
            </div>
          </div>
          <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 uppercase tracking-wide dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-400/25">
            {t("dashboard:chatWorkspace.workspacePhaseBadge")}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1 rounded-xl bg-surface-muted/80 p-1">
          {tabs.map((tab) => {
            const Icon = tabIcons[tab.id];
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={"h-8 rounded-lg text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-all " + (
                  active
                    ? "bg-surface text-content shadow-xs"
                    : "text-content-muted hover:text-slate-700 hover:bg-white/60 dark:hover:text-slate-100 dark:hover:bg-slate-700/60"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 space-y-3 [-webkit-overflow-scrolling:touch]">
        {activeTab === "result" && (
          <WorkspaceResultTab
            t={t}
            pendingApproval={pendingApproval}
            latestApproval={latestApproval}
            canRespondToApproval={canRespondToApproval}
            approvalChoiceLabels={approvalChoiceLabels}
            onRespondToApproval={onRespondToApproval}
            resultSummaryVisible={resultSummaryVisible}
            runningToolCount={runningToolCount}
            completedToolCount={completedToolCount}
            failedToolCount={failedToolCount}
            conversationFiles={conversationFiles}
            latestAssistantUrls={latestAssistantUrls}
            latestAssistantMessage={latestAssistantMessage}
            latestAssistantContent={latestAssistantContent}
            onOpenConversationFile={onOpenConversationFile}
            onDownloadConversationFile={onDownloadConversationFile}
            onCopyConversationFileLink={selectedId && selectedConversationId ? handleCopyConversationFileLink : undefined}
            copiedFileId={copiedFileId}
            getConversationFileSourceLabel={getConversationFileSourceLabel}
            runMetrics={effectiveRunMetrics}
            totalToolCallCount={totalToolCallCount}
            runDisplayStatus={runDisplayStatus}
            runStatusLabel={runStatusLabel}
          />
        )}

        {activeTab === "steps" && (
          <WorkspaceStepsTab
            t={t}
            runningToolCount={runningToolCount}
            completedToolCount={completedToolCount}
            toolSteps={toolSteps}
            filteredToolSteps={filteredToolSteps}
            timelineFilters={timelineFilters}
            timelineFilter={timelineFilter}
            setTimelineFilter={setTimelineFilter}
            hasActiveRunWithoutSteps={hasActiveRunWithoutSteps}
            getTimelineIcon={getTimelineIcon}
            getTimelineLabel={getTimelineLabel}
            getTimelineStatusLabel={getTimelineStatusLabel}
            getTimelineDisplayStatus={getTimelineDisplayStatus}
            getTimelineStepTypeLabel={getTimelineStepTypeLabel}
            formatTimelineTime={formatTimelineTime}
          />
        )}
        {activeTab === "debug" && (
          <WorkspaceDebugTab
            t={t}
            toolSteps={toolSteps}
            runMetrics={effectiveRunMetrics}
            activeRunId={activeRunId}
            getTimelineLabel={getTimelineLabel}
            getTimelineStatusLabel={getTimelineStatusLabel}
            getTimelineStepTypeLabel={getTimelineStepTypeLabel}
            formatTimelineTime={formatTimelineTime}
          />
        )}
        {activeTab === "files" && (
          <WorkspaceFilesTab
            t={t}
            selectedId={selectedId}
            conversationFiles={conversationFiles}
            onPreviewConversationFile={onPreviewConversationFile}
            onOpenConversationFile={onOpenConversationFile}
            onDownloadConversationFile={onDownloadConversationFile}
            onCopyConversationFileLink={selectedId && selectedConversationId ? handleCopyConversationFileLink : undefined}
            copiedFileId={copiedFileId}
            getConversationFileSourceLabel={getConversationFileSourceLabel}
            onDeleteConversationFile={onDeleteConversationFile}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === "preview" && (
          <WorkspacePreviewTab
            t={t}
            conversationFiles={conversationFiles}
            conversationFilePreview={conversationFilePreview}
            onPreviewConversationFile={onPreviewConversationFile}
            onOpenConversationFile={onOpenConversationFile}
            onDownloadConversationFile={onDownloadConversationFile}
            onClearPreview={onClearConversationFilePreview}
          />
        )}
      </div>
    </aside>
  );
}





