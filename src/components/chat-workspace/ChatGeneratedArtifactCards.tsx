import { ChevronDown, ChevronUp, Download, ExternalLink, FileText, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable, type GeneratedArtifact } from "./generatedArtifacts";

export function selectMessageGeneratedArtifacts(
  artifacts: GeneratedArtifact[],
  messageId: string,
  runId?: string | null
): GeneratedArtifact[] {
  return artifacts.flatMap(artifact => {
    const references = artifact.references || [artifact];
    const reference = references.find(item => item.messageId === messageId)
      || references.find(item => Boolean(runId && item.runId === runId));
    return reference ? [{ ...artifact, messageId: reference.messageId, runId: reference.runId, requestId: reference.requestId }] : [];
  });
}

export function canRefreshGeneratedArtifact(artifact: Pick<GeneratedArtifact, "status">) {
  return artifact.status === "missing" || artifact.status === "failed";
}

export function formatGeneratedArtifactSize(size?: number | null) {
  if (typeof size !== "number" || size < 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function ChatGeneratedArtifactCards({ artifacts, onPreview, onDownload, onRefresh }: {
  artifacts: GeneratedArtifact[];
  onPreview?: (path: string) => void;
  onDownload?: (path: string) => void;
  onRefresh?: () => void;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  if (artifacts.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-outline pt-3" data-chat-generated-artifacts="true">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-content-muted">{t("chatWorkspace.messageGeneratedFiles")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {artifacts.map(artifact => {
          const previewable = isGeneratedArtifactPreviewable(artifact);
          const pending = artifact.status === "generating" || artifact.status === "checking";
          const expanded = expandedPaths.has(artifact.path);
          const formattedSize = formatGeneratedArtifactSize(artifact.size);
          const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString(i18n.language) : t("chatWorkspace.messageGeneratedFileUnknownTime");
          const Icon = pending ? LoaderCircle : previewable ? FileText : TriangleAlert;
          return (
            <div key={artifact.path} className="min-w-0 rounded-xl border border-outline bg-surface-muted/65 p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className={`h-4 w-4 shrink-0 ${pending ? "animate-spin text-amber-500" : previewable ? "text-emerald-500" : "text-rose-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-content" title={artifact.path}>{artifact.name}</p>
                  <p className="truncate text-[10px] text-content-muted">{t(`chatWorkspace.workspaceGeneratedArtifactStatus_${artifact.status}`)}</p>
                  <p className="truncate text-[10px] text-content-muted" title={artifact.runId || undefined}>{artifact.runId ? t("chatWorkspace.messageGeneratedFileRunSource", { runId: artifact.runId.slice(0, 8) }) : t("chatWorkspace.messageGeneratedFileConversationSource")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {onPreview && <button type="button" disabled={!previewable} onClick={() => onPreview(getGeneratedArtifactActionPath(artifact))} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-indigo-600 disabled:opacity-30" title={t("chatWorkspace.workspacePreviewFile")}><ExternalLink className="h-3.5 w-3.5" /></button>}
                  {onDownload && <button type="button" disabled={!previewable} onClick={() => onDownload(getGeneratedArtifactActionPath(artifact))} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-emerald-600 disabled:opacity-30" title={t("chatWorkspace.runResultSummaryDownloadFile")}><Download className="h-3.5 w-3.5" /></button>}
                  {onRefresh && canRefreshGeneratedArtifact(artifact) && <button type="button" onClick={onRefresh} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-amber-600" title={t("chatWorkspace.workspaceGeneratedArtifactRefresh")} aria-label={t("chatWorkspace.workspaceGeneratedArtifactRefresh")}><RefreshCw className="h-3.5 w-3.5" /></button>}
                  <button
                    type="button"
                    onClick={() => setExpandedPaths(previous => {
                      const next = new Set(previous);
                      if (next.has(artifact.path)) next.delete(artifact.path);
                      else next.add(artifact.path);
                      return next;
                    })}
                    className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-content"
                    title={t("chatWorkspace.messageGeneratedFileAuditDetails")}
                    aria-label={t("chatWorkspace.messageGeneratedFileAuditDetails")}
                    aria-expanded={expanded}
                  >
                    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {expanded && <div className="mt-2 grid gap-1 border-t border-outline pt-2 text-[10px] leading-4 text-content-muted">
                <span>{t("chatWorkspace.messageGeneratedFileModifiedAt", { time: formatTime(artifact.updatedAt) })}</span>
                <span>{t("chatWorkspace.messageGeneratedFileCheckedAt", { time: formatTime(artifact.checkedAt) })}</span>
                <span>{t("chatWorkspace.messageGeneratedFileSize", { size: formattedSize || t("chatWorkspace.messageGeneratedFileUnknownSize") })}</span>
                <span className="truncate" title={artifact.path}>{t("chatWorkspace.messageGeneratedFilePath", { path: artifact.path })}</span>
                {artifact.error && <span className="break-all text-amber-600 dark:text-amber-400">{t("chatWorkspace.messageGeneratedFileLastError", { error: artifact.error })}</span>}
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
