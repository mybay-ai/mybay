import { Download, ExternalLink, FileText, Image, Loader2, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TFunction } from "i18next";
import type { ConversationFilePreview } from "../useChatWorkspaceFiles";
import type { PendingAttachment } from "../ChatInputBar";

type WorkspacePreviewTabProps = {
  t: TFunction;
  conversationFiles: PendingAttachment[];
  conversationFilePreview: ConversationFilePreview | null;
  onPreviewConversationFile?: (file: PendingAttachment) => void;
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onDownloadConversationFile?: (file: PendingAttachment) => void;
  onClearPreview?: () => void;
};

export function WorkspacePreviewTab({
  t,
  conversationFiles,
  conversationFilePreview,
  onPreviewConversationFile,
  onOpenConversationFile,
  onDownloadConversationFile,
  onClearPreview
}: WorkspacePreviewTabProps) {
  const previewSourceUrl = conversationFilePreview?.url || "";
  const canUsePreviewUrl = Boolean(previewSourceUrl);
  const useBlobActions = conversationFilePreview?.source === "instance" && canUsePreviewUrl;

  return (
          <div className="rounded-xl border border-outline/80 bg-surface p-4 shadow-sm">
            {conversationFilePreview?.loading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-5 h-5 text-indigo-500 mx-auto mb-3 motion-safe:animate-spin" />
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspacePreviewLoading")}
                </p>
              </div>
            ) : conversationFilePreview ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-content truncate">
                      {conversationFilePreview.file.originalName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {(conversationFilePreview.file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {useBlobActions ? (
                      <a href={previewSourceUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : onOpenConversationFile && (
                      <button type="button" onClick={() => onOpenConversationFile(conversationFilePreview.file)} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {useBlobActions ? (
                      <a href={previewSourceUrl} download={conversationFilePreview.file.originalName} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-emerald-600 dark:hover:text-emerald-300" title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}>
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    ) : onDownloadConversationFile && (
                      <button type="button" onClick={() => onDownloadConversationFile(conversationFilePreview.file)} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-emerald-600 dark:hover:text-emerald-300" title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}>
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onClearPreview && (
                      <button type="button" onClick={onClearPreview} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-content-secondary" title={t("dashboard:files_close_preview_title")} aria-label={t("dashboard:files_close_preview_title")}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {conversationFilePreview.error ? (
                  <div className="rounded-xl border border-dashed border-outline bg-surface-muted/70 px-4 py-8 text-center">
                    <FileText className="mx-auto mb-3 h-5 w-5 text-slate-400" />
                    <p className="text-[13px] leading-5 text-content-muted">
                      {conversationFilePreview.error}
                    </p>
                    {useBlobActions && (
                      <div className="mt-4 flex justify-center gap-2">
                        <a href={previewSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12px] font-semibold text-content-secondary hover:border-indigo-200 hover:text-indigo-600 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300">
                          <ExternalLink className="h-3.5 w-3.5" />
                          {t("dashboard:chatWorkspace.runResultSummaryOpenFile")}
                        </a>
                        <a href={previewSourceUrl} download={conversationFilePreview.file.originalName} className="inline-flex items-center gap-1.5 rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12px] font-semibold text-content-secondary hover:border-emerald-200 hover:text-emerald-600 dark:hover:border-emerald-400/40 dark:hover:text-emerald-300">
                          <Download className="h-3.5 w-3.5" />
                          {t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}
                        </a>
                      </div>
                    )}
                  </div>
                ) : conversationFilePreview.kind === "image" && conversationFilePreview.url ? (
                  <div className="overflow-hidden rounded-xl border border-outline bg-surface-muted">
                    <img src={conversationFilePreview.url} alt={conversationFilePreview.file.originalName} className="max-h-[520px] w-full object-contain" />
                  </div>
                ) : conversationFilePreview.kind === "html" && (conversationFilePreview.text || conversationFilePreview.url) ? (
                  <iframe
                    src={conversationFilePreview.text ? undefined : conversationFilePreview.url}
                    srcDoc={conversationFilePreview.text || undefined}
                    title={conversationFilePreview.file.originalName}
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerPolicy="no-referrer"
                    className="h-[520px] w-full rounded-xl border border-outline bg-white"
                  />
                ) : conversationFilePreview.kind === "pdf" && conversationFilePreview.url ? (
                  <iframe
                    src={conversationFilePreview.url}
                    title={conversationFilePreview.file.originalName}
                    className="h-[520px] w-full rounded-xl border border-outline bg-white"
                  />
                ) : conversationFilePreview.kind === "markdown" ? (
                  <div className="prose prose-sm max-h-[520px] max-w-none overflow-auto rounded-xl border border-outline bg-surface-muted p-4 text-content-secondary prose-a:text-indigo-600 dark:prose-invert">
                    <Markdown remarkPlugins={[remarkGfm]}>{conversationFilePreview.text || ""}</Markdown>
                  </div>
                ) : conversationFilePreview.kind === "text" ? (
                  <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-outline bg-surface-muted p-3 text-[12px] leading-5 text-content-secondary">
                    {conversationFilePreview.text || ""}
                  </pre>
                ) : (
                  <div className="rounded-xl border border-dashed border-outline bg-surface-muted/70 px-4 py-8 text-center">
                    <FileText className="mx-auto mb-3 h-5 w-5 text-slate-400" />
                    <p className="text-[13px] leading-5 text-content-muted">
                      {t("dashboard:chatWorkspace.workspacePreviewUnsupportedDesc")}
                    </p>
                  </div>
                )}
              </div>
            ) : conversationFiles.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspacePreviewSelectTitle")}
                </p>
                <p className="text-[13px] leading-5 text-content-muted">
                  {t("dashboard:chatWorkspace.workspacePreviewSelectDesc")}
                </p>
                <div className="pt-2 space-y-2">
                  {conversationFiles.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => onPreviewConversationFile?.(file)}
                      className="flex w-full items-center gap-3 rounded-lg border border-outline bg-surface-muted p-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10"
                    >
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content-secondary">{file.originalName}</span>
                      <Image className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <Image className="w-5 h-5 text-slate-400 mb-3" />
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspacePreviewEmptyTitle")}
                </p>
                <p className="text-[13px] leading-5 text-content-muted mt-1">
                  {t("dashboard:chatWorkspace.workspacePreviewEmptyDesc")}
                </p>
              </>
            )}
          </div>
        
  );
}
