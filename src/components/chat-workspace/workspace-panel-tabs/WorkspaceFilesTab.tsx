import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, FileText, GitBranch, HardDrive, Image, Sparkles, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { PendingAttachment } from "../ChatInputBar";
import { api } from "../../../lib/api";

type WorkspaceFileUsage = {
  totalBytes?: number;
  recommendations?: { size: number }[];
  quota?: {
    storageUsedBytes?: number | null;
    storageLimitBytes?: number | null;
    storageUsagePercent?: number | null;
  };
};

function formatWorkspaceBytes(bytes?: number | null) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "--";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return parseFloat((bytes / Math.pow(1024, index)).toFixed(2)) + " " + units[index];
}

function openInstanceFileManager(instanceId?: string) {
  if (!instanceId || typeof window === "undefined") return;
  window.location.href = "/app?id=" + encodeURIComponent(instanceId) + "&tab=files";
}

type WorkspaceFilesTabProps = {
  t: TFunction;
  selectedId?: string;
  conversationFiles: PendingAttachment[];
  onPreviewConversationFile?: (file: PendingAttachment) => void;
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onDownloadConversationFile?: (file: PendingAttachment) => void;
  onCopyConversationFileLink?: (file: PendingAttachment) => void;
  copiedFileId?: string | null;
  getConversationFileSourceLabel?: (file: PendingAttachment) => string;
  onDeleteConversationFile?: (fileId: string) => void;
  setActiveTab: (tab: "preview") => void;
};

export function WorkspaceFilesTab({
  t,
  selectedId,
  conversationFiles,
  onPreviewConversationFile,
  onOpenConversationFile,
  onDownloadConversationFile,
  onCopyConversationFileLink,
  copiedFileId = null,
  getConversationFileSourceLabel,
  onDeleteConversationFile,
  setActiveTab
}: WorkspaceFilesTabProps) {

  const [usage, setUsage] = useState<WorkspaceFileUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setUsage(null);
      return;
    }
    setUsageLoading(true);
    api.get("/api/instances/" + encodeURIComponent(selectedId) + "/files/usage")
      .then(data => {
        if (!cancelled) setUsage(data || null);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      })
      .finally(() => {
        if (!cancelled) setUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const usedBytes = usage?.quota?.storageUsedBytes ?? usage?.totalBytes ?? null;
  const limitBytes = usage?.quota?.storageLimitBytes ?? null;
  const percent = typeof usage?.quota?.storageUsagePercent === "number" ? usage.quota.storageUsagePercent : null;
  const recommendedBytes = (usage?.recommendations || []).reduce((sum, item) => sum + (item.size || 0), 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-sm dark:border-indigo-900/40 dark:bg-indigo-950/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-surface text-indigo-600 dark:border-indigo-900/50">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-content">{t("dashboard:chatWorkspace.workspaceStorageTitle")}</p>
              <p className="mt-1 text-[12px] leading-5 text-content-muted">
                {usageLoading
                  ? t("dashboard:chatWorkspace.workspaceStorageLoading")
                  : t("dashboard:chatWorkspace.workspaceStorageSummary", {
                      used: formatWorkspaceBytes(usedBytes),
                      limit: limitBytes ? formatWorkspaceBytes(limitBytes) : t("dashboard:chatWorkspace.workspaceStorageUnlimited"),
                      percent: percent === null ? "--" : percent
                    })}
              </p>
              {!!usage?.recommendations?.length && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <Sparkles className="h-3 w-3" />
                  {t("dashboard:chatWorkspace.workspaceStorageCleanupHint", { size: formatWorkspaceBytes(recommendedBytes) })}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => openInstanceFileManager(selectedId)}
            disabled={!selectedId}
            className="shrink-0 rounded-lg border border-indigo-200 bg-surface px-3 py-1.5 text-[12px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900/50 dark:text-indigo-300"
          >
            {t("dashboard:chatWorkspace.workspaceStorageOpenManager")}
          </button>
        </div>
      </div>

          <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
            {conversationFiles.length === 0 ? (
              <>
                <FileText className="w-5 h-5 text-slate-400 mb-3" />
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspaceFilesEmptyTitle")}
                </p>
                <p className="text-[13px] leading-5 text-content-muted mt-1">
                  {t("dashboard:chatWorkspace.workspaceFilesEmptyDesc")}
                </p>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-content mb-3">{t("dashboard:chatWorkspace.workspaceConversationFilesTitle", { count: conversationFiles.length })}</p>
                {conversationFiles.map(file => (
                  <div key={file.id} className="flex items-center gap-3 p-2 rounded-lg border border-outline bg-surface-muted">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-content-secondary truncate">{file.originalName}</p>
                      <p className="text-[11px] text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        <span className="truncate">{t("dashboard:chatWorkspace.workspaceFileSourcePrefix")} {getConversationFileSourceLabel?.(file) || t("dashboard:chatWorkspace.workspaceFileSourceUnknown")}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onPreviewConversationFile && (
                        <button
                          type="button"
                          onClick={() => {
                            onPreviewConversationFile(file);
                            setActiveTab("preview");
                          }}
                          className="p-1 rounded-full text-slate-400 hover:bg-outline hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                          title={t("dashboard:chatWorkspace.workspacePreviewFile")}
                        >
                          <Image className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onOpenConversationFile && (
                        <button
                          type="button"
                          onClick={() => onOpenConversationFile(file)}
                          className="p-1 rounded-full text-slate-400 hover:bg-outline hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                          title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onCopyConversationFileLink && (
                        <button
                          type="button"
                          onClick={() => onCopyConversationFileLink(file)}
                          className="p-1 rounded-full text-slate-400 hover:bg-outline hover:text-sky-600 dark:hover:text-sky-300 transition-colors"
                          title={copiedFileId === file.id ? t("dashboard:chatWorkspace.workspaceFileLinkCopied") : t("dashboard:chatWorkspace.workspaceCopyFileLink")}
                        >
                          {copiedFileId === file.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {onDownloadConversationFile && (
                        <button
                          type="button"
                          onClick={() => onDownloadConversationFile(file)}
                          className="p-1 rounded-full text-slate-400 hover:bg-outline hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                          title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDeleteConversationFile && (
                        <button
                          type="button"
                          onClick={() => onDeleteConversationFile(file.id)}
                          className="p-1 rounded-full text-slate-400 hover:bg-outline hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          title={t("dashboard:chatWorkspace.workspaceDeleteFile")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
    </div>
  );
}
