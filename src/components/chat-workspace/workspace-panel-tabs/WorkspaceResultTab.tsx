import { Activity, AlertTriangle, Check, CheckCircle2, Clock3, Copy, Download, ExternalLink, FileText, GitBranch, Sparkles } from "lucide-react";
import type { TFunction } from "i18next";
import type { ChatMessage } from "../../../lib/chatWorkspaceState";
import type { ChatApprovalChoice, ChatApprovalRequest, ChatRunMetrics } from "../useChatRuns";
import type { PendingAttachment } from "../ChatInputBar";
import type { RunDisplayStatus } from "../run/runStatusSemantics";
import { isGeneratedArtifactPreviewable, type GeneratedArtifact } from "../generatedArtifacts";

type WorkspaceResultTabProps = {
  t: TFunction;
  pendingApproval?: ChatApprovalRequest;
  latestApproval?: ChatApprovalRequest;
  canRespondToApproval: boolean;
  approvalChoiceLabels: Record<ChatApprovalChoice, string>;
  onRespondToApproval?: (choice: ChatApprovalChoice, approvalId?: string, resolveAll?: boolean) => void;
  resultSummaryVisible: boolean;
  runningToolCount: number;
  completedToolCount: number;
  failedToolCount: number;
  conversationFiles: PendingAttachment[];
  generatedArtifacts?: GeneratedArtifact[];
  latestAssistantUrls: string[];
  latestAssistantMessage?: ChatMessage;
  latestAssistantContent: string;
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onDownloadConversationFile?: (file: PendingAttachment) => void;
  onCopyConversationFileLink?: (file: PendingAttachment) => void;
  copiedFileId?: string | null;
  getConversationFileSourceLabel?: (file: PendingAttachment) => string;
  onPreviewGeneratedArtifact?: (filePath: string) => void;
  onDownloadGeneratedArtifact?: (filePath: string) => void;
  runMetrics: ChatRunMetrics;
  totalToolCallCount: number;
  runDisplayStatus: RunDisplayStatus;
  runStatusLabel: string;
};

export function WorkspaceResultTab({
  t,
  pendingApproval,
  latestApproval,
  canRespondToApproval,
  approvalChoiceLabels,
  onRespondToApproval,
  resultSummaryVisible,
  runningToolCount,
  completedToolCount,
  failedToolCount,
  conversationFiles,
  generatedArtifacts = [],
  latestAssistantUrls,
  latestAssistantMessage,
  latestAssistantContent,
  onOpenConversationFile,
  onDownloadConversationFile,
  onCopyConversationFileLink,
  copiedFileId = null,
  getConversationFileSourceLabel,
  onPreviewGeneratedArtifact,
  onDownloadGeneratedArtifact,
  runMetrics,
  totalToolCallCount,
  runDisplayStatus,
  runStatusLabel
}: WorkspaceResultTabProps) {
  const formatDuration = (value?: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return t("dashboard:chatWorkspace.metricUnavailable");
    }
    if (value < 1000) return `${Math.round(value)} ms`;
    const seconds = value / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}m ${rest}s`;
  };

  const formatTokenCount = (value?: number | null) => (
    typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString()
      : t("dashboard:chatWorkspace.metricUnavailable")
  );
  return (
          <>
            {pendingApproval && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 inline-flex items-center justify-center">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-100">
                      {t("dashboard:chatWorkspace.approvalRequiredTitle")}
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-amber-800/80 dark:text-amber-100/75">
                      {pendingApproval.description || pendingApproval.title || t("dashboard:chatWorkspace.approvalRequiredDesc")}
                    </p>
                    {pendingApproval.command && (
                      <pre className="mt-3 max-h-28 overflow-auto rounded-lg border border-amber-200/70 bg-surface/70 p-2 text-[12px] leading-5 text-amber-950 whitespace-pre-wrap dark:border-amber-400/20 dark:text-amber-100">
                        {pendingApproval.command}
                      </pre>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(pendingApproval.choices?.length ? pendingApproval.choices : (["once", "deny"] as ChatApprovalChoice[])).map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          disabled={!canRespondToApproval}
                          onClick={() => onRespondToApproval?.(choice, pendingApproval.id)}
                          className={"rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 " + (
                            choice === "deny"
                              ? "border border-rose-200 bg-surface text-rose-600 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                              : "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                          )}
                        >
                          {approvalChoiceLabels[choice] || choice}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!pendingApproval && latestApproval?.status === "resolved" && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                <div className="flex items-center gap-2 text-[13px] font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("dashboard:chatWorkspace.approvalResolved")}
                </div>
              </div>
            )}
            {runDisplayStatus !== "idle" && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-outline/80 bg-surface px-3 py-2.5 shadow-sm">
                <span className="text-[13px] font-semibold text-content">{t("dashboard:chatWorkspace.runStatusLabel")}</span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${runDisplayStatus === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : runDisplayStatus === "failed" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : runDisplayStatus === "stopped" || runDisplayStatus === "stopping" || runDisplayStatus === "waiting_for_approval" ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"}`}>{runStatusLabel}</span>
              </div>
            )}
            {resultSummaryVisible && (
              <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-content">
                    {t("dashboard:chatWorkspace.runResultSummaryTitle")}
                  </p>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {t("dashboard:chatWorkspace.workspaceStepStats", { running: runningToolCount, completed: completedToolCount })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-lg bg-surface-muted px-2.5 py-2 text-content-secondary">
                    {t("dashboard:chatWorkspace.runResultSummaryCompleted", { count: completedToolCount })}
                  </div>
                  <div className="rounded-lg bg-surface-muted px-2.5 py-2 text-content-secondary">
                    {runningToolCount > 0
                      ? t("dashboard:chatWorkspace.runResultSummaryRunning", { count: runningToolCount })
                      : t("dashboard:chatWorkspace.runResultSummaryFailed", { count: failedToolCount })}
                  </div>
                  <div className="rounded-lg bg-surface-muted px-2.5 py-2 text-content-secondary">
                    {t("dashboard:chatWorkspace.runResultSummaryFiles", { count: conversationFiles.length + generatedArtifacts.length })}
                  </div>
                  <div className="rounded-lg bg-surface-muted px-2.5 py-2 text-content-secondary">
                    {t("dashboard:chatWorkspace.runResultSummaryLinks", { count: latestAssistantUrls.length })}
                  </div>
                </div>


                <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div className="rounded-lg border border-outline bg-surface-muted px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                      <Activity className="h-3.5 w-3.5" />
                      <span>{t("dashboard:chatWorkspace.metricToolCalls")}</span>
                    </div>
                    <p className="font-semibold text-content-secondary">{totalToolCallCount}</p>
                  </div>
                  <div className="rounded-lg border border-outline bg-surface-muted px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                      <Clock3 className="h-3.5 w-3.5" />
                      <span>{t("dashboard:chatWorkspace.metricDuration")}</span>
                    </div>
                    <p className="font-semibold text-content-secondary">{formatDuration(runMetrics.durationMs)}</p>
                  </div>
                  <div className="rounded-lg border border-outline bg-surface-muted px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>{t("dashboard:chatWorkspace.metricTokens")}</span>
                    </div>
                    <p className="font-semibold text-content-secondary">{formatTokenCount(runMetrics.usageTotalTokens)}</p>
                  </div>
                </div>

                {generatedArtifacts.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[12px] font-semibold text-content-muted">{t("dashboard:chatWorkspace.workspaceGeneratedArtifactsTitle", { count: generatedArtifacts.length })}</p>
                    <div className="space-y-2">
                      {generatedArtifacts.slice(0, 3).map((artifact) => {
                        const ready = isGeneratedArtifactPreviewable(artifact);
                        return (
                          <div key={artifact.path} className="flex items-center gap-2 rounded-lg border border-outline bg-surface-muted px-2.5 py-2">
                            <FileText className={`h-4 w-4 shrink-0 ${ready ? "text-emerald-500" : artifact.status === "generating" || artifact.status === "checking" ? "text-amber-500" : "text-red-500"}`} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-content-secondary">{artifact.name}</p>
                              <p className="truncate text-[11px] text-slate-400">{t(`dashboard:chatWorkspace.workspaceGeneratedArtifactStatus_${artifact.status}`)}</p>
                            </div>
                            {onPreviewGeneratedArtifact && <button type="button" disabled={!ready} onClick={() => onPreviewGeneratedArtifact(artifact.path)} className="rounded-full p-1 text-slate-400 hover:bg-surface hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-35" title={t("dashboard:chatWorkspace.workspacePreviewFile")}><ExternalLink className="h-3.5 w-3.5" /></button>}
                            {onDownloadGeneratedArtifact && <button type="button" disabled={!ready} onClick={() => onDownloadGeneratedArtifact(artifact.path)} className="rounded-full p-1 text-slate-400 hover:bg-surface hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-35" title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}><Download className="h-3.5 w-3.5" /></button>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {conversationFiles.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[12px] font-semibold text-content-muted">
                      {t("dashboard:chatWorkspace.runResultSummaryFilesTitle")}
                    </p>
                    <div className="space-y-2">
                      {conversationFiles.slice(0, 3).map((file) => (
                        <div key={file.id} className="flex items-center gap-2 rounded-lg border border-outline bg-surface-muted px-2.5 py-2">
                          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-content-secondary">{file.originalName}</p>
                            <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
                              <GitBranch className="h-3 w-3 shrink-0" />
                              <span className="truncate">{t("dashboard:chatWorkspace.workspaceFileSourcePrefix")} {getConversationFileSourceLabel?.(file) || t("dashboard:chatWorkspace.workspaceFileSourceUnknown")}</span>
                            </p>
                          </div>
                          {onOpenConversationFile && (
                            <button type="button" onClick={() => onOpenConversationFile(file)} className="rounded-full p-1 text-slate-400 transition-colors hover:bg-surface hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onCopyConversationFileLink && (
                            <button type="button" onClick={() => onCopyConversationFileLink(file)} className="rounded-full p-1 text-slate-400 transition-colors hover:bg-surface hover:text-sky-600 dark:hover:text-sky-300" title={copiedFileId === file.id ? t("dashboard:chatWorkspace.workspaceFileLinkCopied") : t("dashboard:chatWorkspace.workspaceCopyFileLink")}>
                              {copiedFileId === file.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {onDownloadConversationFile && (
                            <button type="button" onClick={() => onDownloadConversationFile(file)} className="rounded-full p-1 text-slate-400 transition-colors hover:bg-surface hover:text-emerald-600 dark:hover:text-emerald-300" title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}>
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {latestAssistantUrls.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 text-[12px] font-semibold text-content-muted">
                      {t("dashboard:chatWorkspace.runResultSummaryLinksTitle")}
                    </p>
                    <div className="space-y-2">
                      {latestAssistantUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-outline bg-surface-muted px-2.5 py-2 text-[13px] font-medium text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{url}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspaceCurrentResult")}
                </p>
                {(runningToolCount > 0 || completedToolCount > 0) && (
                  <span className="text-[11px] font-medium text-content-muted bg-surface-muted rounded-full px-2 py-0.5">
                    {t("dashboard:chatWorkspace.workspaceStepStats", { running: runningToolCount, completed: completedToolCount })}
                  </span>
                )}
              </div>
              {latestAssistantMessage || latestAssistantContent ? (
                <p className="max-h-[min(48dvh,32rem)] overflow-y-auto overscroll-contain whitespace-pre-wrap pr-1 text-[14px] leading-6 text-content-secondary [-webkit-overflow-scrolling:touch]">
                  {latestAssistantContent}
                </p>
              ) : (
                <div className="py-6 text-center">
                  <Sparkles className="w-5 h-5 text-indigo-400 mx-auto mb-2" />
                  <p className="text-[13px] font-medium text-content-secondary">
                    {t("dashboard:chatWorkspace.workspaceResultEmptyTitle")}
                  </p>
                  <p className="text-[13px] leading-5 text-content-muted mt-1">
                    {t("dashboard:chatWorkspace.workspaceResultEmptyDesc")}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-dashed border-outline bg-surface/70 p-3">
              <p className="text-[13px] leading-5 text-content-muted">
                {t("dashboard:chatWorkspace.workspacePhaseOneHint")}
              </p>
            </div>
          </>
        
  );
}
