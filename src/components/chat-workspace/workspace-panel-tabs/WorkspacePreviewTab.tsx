import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Code2, Download, ExternalLink, FileText, Image, Loader2, Maximize2, Monitor, RefreshCw, X } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TFunction } from "i18next";
import type { ConversationFilePreview } from "../useChatWorkspaceFiles";
import type { PendingAttachment } from "../ChatInputBar";
import { buildSandboxedHtmlPreviewDocument, HTML_PREVIEW_IFRAME_SANDBOX, isSvgPreviewFile } from "../previewSecurity";
import { getGeneratedArtifactActionPath, isGeneratedArtifactPreviewable, type GeneratedArtifact } from "../generatedArtifacts";

type WorkspacePreviewTabProps = {
  t: TFunction;
  conversationFiles: PendingAttachment[];
  generatedArtifacts?: GeneratedArtifact[];
  conversationFilePreview: ConversationFilePreview | null;
  onPreviewConversationFile?: (file: PendingAttachment) => void;
  onOpenConversationFile?: (file: PendingAttachment) => void;
  onDownloadConversationFile?: (file: PendingAttachment) => void;
  onClearPreview?: () => void;
  onPreviewGeneratedArtifact?: (filePath: string) => void;
};

export function getVideoPreviewErrorTranslationKey(code?: number | null): string {
  if (code === 1) return "dashboard:chatWorkspace.workspaceVideoErrorAborted";
  if (code === 2) return "dashboard:chatWorkspace.workspaceVideoErrorNetwork";
  if (code === 3) return "dashboard:chatWorkspace.workspaceVideoErrorDecode";
  if (code === 4) return "dashboard:chatWorkspace.workspaceVideoErrorUnsupported";
  return "dashboard:chatWorkspace.workspaceVideoErrorUnknown";
}

function WorkspaceVideoPreview({
  t,
  url,
  fileName,
  downloadUrl,
  onDownload,
}: {
  t: TFunction;
  url: string;
  fileName: string;
  downloadUrl?: string;
  onDownload?: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    setRevision(0);
    setLoading(true);
    setErrorKey(null);
  }, [url]);

  const retry = () => {
    setErrorKey(null);
    setLoading(true);
    setRevision(value => value + 1);
  };

  return (
    <div className="space-y-2" data-video-stream-preview="true">
      <div className="relative overflow-hidden rounded-xl border border-outline bg-black">
        <video
          key={`${url}:${revision}`}
          src={url}
          controls
          playsInline
          preload="metadata"
          className="max-h-[min(52dvh,620px)] w-full bg-black sm:max-h-[620px]"
          onLoadStart={() => { setLoading(true); setErrorKey(null); }}
          onLoadedMetadata={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onError={(event) => {
            setLoading(false);
            setErrorKey(getVideoPreviewErrorTranslationKey(event.currentTarget.error?.code));
          }}
        />
        {loading && !errorKey && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
            <div className="inline-flex items-center gap-2 rounded-lg bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white">
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
              {t("dashboard:chatWorkspace.workspaceVideoLoading")}
            </div>
          </div>
        )}
      </div>
      {errorKey ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-[12px] leading-5">{t(errorKey)}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-900/40 dark:hover:bg-amber-500/10">
              <RefreshCw className="h-3.5 w-3.5" />
              {t("dashboard:chatWorkspace.workspaceVideoRetry")}
            </button>
            {downloadUrl ? (
              <a href={downloadUrl} download={fileName} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-900/40 dark:hover:bg-amber-500/10">
                <Download className="h-3.5 w-3.5" />
                {t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}
              </a>
            ) : onDownload ? (
              <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-900/40 dark:hover:bg-amber-500/10">
                <Download className="h-3.5 w-3.5" />
                {t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-5 text-content-muted">{t("dashboard:chatWorkspace.workspaceVideoPreviewHint")}</p>
      )}
    </div>
  );
}

export function WorkspacePreviewTab({
  t,
  conversationFiles,
  generatedArtifacts = [],
  conversationFilePreview,
  onPreviewConversationFile,
  onOpenConversationFile,
  onDownloadConversationFile,
  onClearPreview,
  onPreviewGeneratedArtifact
}: WorkspacePreviewTabProps) {
  const [htmlPreviewMode, setHtmlPreviewMode] = useState<"source" | "page">("page");
  const [htmlPreviewRevision, setHtmlPreviewRevision] = useState(0);
  const [htmlPreviewExpanded, setHtmlPreviewExpanded] = useState(false);
  const previewSourceUrl = conversationFilePreview?.url || "";
  const canUsePreviewUrl = Boolean(previewSourceUrl);
  const directDownloadUrl = conversationFilePreview?.downloadUrl || previewSourceUrl;
  const useDirectDownloadAction = conversationFilePreview?.source === "instance" && Boolean(directDownloadUrl);
  const useDirectOpenAction = useDirectDownloadAction
    && conversationFilePreview?.kind !== "html"
    && !isSvgPreviewFile(conversationFilePreview?.file.originalName || "", conversationFilePreview?.file.mimeType || "");
  const useConversationActions = conversationFilePreview?.source === "conversation";
  const interactiveHtmlPreviewUrl = conversationFilePreview?.htmlPreviewUrl;
  const sandboxedHtml = conversationFilePreview?.kind === "html" && conversationFilePreview.text && !interactiveHtmlPreviewUrl
    ? buildSandboxedHtmlPreviewDocument(conversationFilePreview.text)
    : undefined;
  const hasHtmlPagePreview = Boolean(interactiveHtmlPreviewUrl || sandboxedHtml);

  useEffect(() => {
    setHtmlPreviewMode("page");
    setHtmlPreviewRevision(0);
    setHtmlPreviewExpanded(false);
  }, [conversationFilePreview?.file.id]);

  useEffect(() => {
    if (!htmlPreviewExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHtmlPreviewExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [htmlPreviewExpanded]);

  const renderHtmlPreviewFrame = (expanded = false) => (
    <iframe
      key={`${conversationFilePreview?.file.id || "html"}:${htmlPreviewRevision}:${expanded ? "expanded" : "panel"}`}
      src={interactiveHtmlPreviewUrl || (sandboxedHtml ? undefined : conversationFilePreview?.url)}
      srcDoc={sandboxedHtml}
      title={conversationFilePreview?.file.originalName || "HTML preview"}
      sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      data-html-preview-frame="single-sandbox"
      className={expanded
        ? "h-full min-h-0 w-full border-0 bg-white"
        : "h-[min(52dvh,620px)] min-h-72 w-full rounded-xl border border-outline bg-white sm:h-[620px]"}
    />
  );

  const expandedHtmlPreview = htmlPreviewExpanded && hasHtmlPagePreview && typeof document !== "undefined"
    ? createPortal(
        <div
          className="fixed inset-0 z-[10050] flex flex-col bg-slate-950/70 p-2 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("dashboard:chatWorkspace.webPreviewExpandedTitle")}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setHtmlPreviewExpanded(false);
          }}
        >
          <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-outline bg-surface shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-outline px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-content">{conversationFilePreview?.file.originalName}</p>
                <p className="text-[11px] text-content-muted">{t("dashboard:chatWorkspace.webPreviewSandboxHint")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setHtmlPreviewRevision(revision => revision + 1)} className="rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content" title={t("dashboard:chatWorkspace.webPreviewRefresh")} aria-label={t("dashboard:chatWorkspace.webPreviewRefresh")}>
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setHtmlPreviewExpanded(false)} className="rounded-lg p-2 text-content-muted hover:bg-surface-muted hover:text-content" title={t("dashboard:chatWorkspace.webPreviewCollapse")} aria-label={t("dashboard:chatWorkspace.webPreviewCollapse")}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 bg-white">{renderHtmlPreviewFrame(true)}</div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
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
                    {conversationFilePreview.file.size > 0 && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {(conversationFilePreview.file.size / 1024).toFixed(1)} KB
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {useDirectOpenAction ? (
                      <a href={previewSourceUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : useConversationActions && onOpenConversationFile && (
                      <button type="button" onClick={() => onOpenConversationFile(conversationFilePreview.file)} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.runResultSummaryOpenFile")}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {useDirectDownloadAction ? (
                      <a href={directDownloadUrl} download={conversationFilePreview.file.originalName} className="p-1.5 rounded-full text-slate-400 hover:bg-surface-muted hover:text-emerald-600 dark:hover:text-emerald-300" title={t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}>
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

                {conversationFilePreview.kind === "html" && hasHtmlPagePreview && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-outline bg-surface-muted/70 p-1.5">
                    <div className="flex items-center rounded-md bg-surface p-0.5 shadow-xs">
                      <button type="button" onClick={() => setHtmlPreviewMode("source")} className={`${htmlPreviewMode === "source" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "text-content-muted hover:text-content"} inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold`} title={t("dashboard:chatWorkspace.webPreviewSourceMode")}>
                        <Code2 className="h-3.5 w-3.5" />
                        {t("dashboard:chatWorkspace.webPreviewSourceMode")}
                      </button>
                      <button type="button" onClick={() => setHtmlPreviewMode("page")} className={`${htmlPreviewMode === "page" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "text-content-muted hover:text-content"} inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold`} title={t("dashboard:chatWorkspace.webPreviewPageMode")}>
                        <Monitor className="h-3.5 w-3.5" />
                        {t("dashboard:chatWorkspace.webPreviewPageMode")}
                      </button>
                    </div>
                    {htmlPreviewMode === "page" && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setHtmlPreviewRevision(revision => revision + 1)} className="rounded-md p-1.5 text-content-muted hover:bg-surface hover:text-content" title={t("dashboard:chatWorkspace.webPreviewRefresh")} aria-label={t("dashboard:chatWorkspace.webPreviewRefresh")}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => setHtmlPreviewExpanded(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-content-muted hover:bg-surface hover:text-indigo-600 dark:hover:text-indigo-300" title={t("dashboard:chatWorkspace.webPreviewExpand")}>
                          <Maximize2 className="h-3.5 w-3.5" />
                          {t("dashboard:chatWorkspace.webPreviewExpand")}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {conversationFilePreview.error ? (
                  <div className="rounded-xl border border-dashed border-outline bg-surface-muted/70 px-4 py-8 text-center">
                    <AlertTriangle className="mx-auto mb-3 h-5 w-5 text-amber-500" />
                    <p className="text-[13px] leading-5 text-content-muted">
                      {conversationFilePreview.error}
                    </p>
                    {conversationFilePreview.missingDependencies && conversationFilePreview.missingDependencies.length > 0 && (
                      <div className="mx-auto mt-3 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-left dark:border-amber-400/30 dark:bg-amber-500/10">
                        {conversationFilePreview.missingDependencies.map(dependency => (
                          <code key={dependency} className="block break-all text-[11px] leading-5 text-amber-800 dark:text-amber-200">{dependency}</code>
                        ))}
                      </div>
                    )}
                    {useDirectDownloadAction && (
                      <div className="mt-4 flex justify-center gap-2">
                        {conversationFilePreview.source === "instance" && conversationFilePreview.instancePath && onPreviewGeneratedArtifact && (
                          <button type="button" onClick={() => onPreviewGeneratedArtifact(getGeneratedArtifactActionPath({ path: conversationFilePreview.instancePath! }))} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-surface px-3 py-1.5 text-[12px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-400/30 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
                            <RefreshCw className="h-3.5 w-3.5" />
                            {t("dashboard:chatWorkspace.workspaceVideoRetry")}
                          </button>
                        )}
                        {useDirectOpenAction && <a href={previewSourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12px] font-semibold text-content-secondary hover:border-indigo-200 hover:text-indigo-600 dark:hover:border-indigo-400/40 dark:hover:text-indigo-300">
                            <ExternalLink className="h-3.5 w-3.5" />
                            {t("dashboard:chatWorkspace.runResultSummaryOpenFile")}
                          </a>}
                        <a href={directDownloadUrl} download={conversationFilePreview.file.originalName} className="inline-flex items-center gap-1.5 rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12px] font-semibold text-content-secondary hover:border-emerald-200 hover:text-emerald-600 dark:hover:border-emerald-400/40 dark:hover:text-emerald-300">
                          <Download className="h-3.5 w-3.5" />
                          {t("dashboard:chatWorkspace.runResultSummaryDownloadFile")}
                        </a>
                      </div>
                    )}
                  </div>
                ) : conversationFilePreview.kind === "image" && conversationFilePreview.url ? (
                  <div className="overflow-hidden rounded-xl border border-outline bg-surface-muted">
                    <img src={conversationFilePreview.url} alt={conversationFilePreview.file.originalName} className="max-h-[min(44dvh,520px)] w-full object-contain sm:max-h-[520px]" />
                  </div>
                ) : conversationFilePreview.kind === "html" && hasHtmlPagePreview ? (
                  htmlPreviewMode === "page" ? renderHtmlPreviewFrame() : (
                    <pre className="max-h-[min(52dvh,620px)] overflow-auto overscroll-contain whitespace-pre rounded-xl border border-outline bg-slate-950 p-4 text-[12px] leading-5 text-slate-100 sm:max-h-[620px] [-webkit-overflow-scrolling:touch]" data-html-preview-source="true">
                      <code>{conversationFilePreview.text || ""}</code>
                    </pre>
                  )
                ) : conversationFilePreview.kind === "html" && conversationFilePreview.url ? (
                  <iframe
                    src={conversationFilePreview.url}
                    title={conversationFilePreview.file.originalName}
                    sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
                    referrerPolicy="no-referrer"
                    className="h-[min(52dvh,620px)] min-h-72 w-full rounded-xl border border-outline bg-white sm:h-[620px]"
                  />
                ) : conversationFilePreview.kind === "pdf" && conversationFilePreview.url ? (
                  <iframe
                    src={conversationFilePreview.url}
                    title={conversationFilePreview.file.originalName}
                    className="h-[min(44dvh,520px)] min-h-64 w-full rounded-xl border border-outline bg-white sm:h-[520px]"
                  />
                ) : conversationFilePreview.kind === "video" && conversationFilePreview.url ? (
                  <WorkspaceVideoPreview
                    t={t}
                    url={conversationFilePreview.url}
                    fileName={conversationFilePreview.file.originalName}
                    downloadUrl={useDirectDownloadAction ? directDownloadUrl : undefined}
                    onDownload={useConversationActions && onDownloadConversationFile
                      ? () => onDownloadConversationFile(conversationFilePreview.file)
                      : undefined}
                  />
                ) : conversationFilePreview.kind === "office" && conversationFilePreview.officeHtml ? (
                  <iframe
                    srcDoc={conversationFilePreview.officeHtml}
                    title={conversationFilePreview.file.originalName}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    className="h-[min(52dvh,680px)] min-h-80 w-full rounded-xl border border-outline bg-white sm:h-[680px]"
                  />
                ) : conversationFilePreview.kind === "markdown" ? (
                  <div className="prose prose-sm max-h-[min(44dvh,520px)] max-w-none overflow-auto overscroll-contain rounded-xl border border-outline bg-surface-muted p-4 text-content-secondary prose-a:text-indigo-600 dark:prose-invert sm:max-h-[520px] [-webkit-overflow-scrolling:touch]">
                    <Markdown remarkPlugins={[remarkGfm]}>{conversationFilePreview.text || ""}</Markdown>
                  </div>
                ) : conversationFilePreview.kind === "text" ? (
                  <pre className="max-h-[min(44dvh,520px)] overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl border border-outline bg-surface-muted p-3 text-[12px] leading-5 text-content-secondary sm:max-h-[520px] [-webkit-overflow-scrolling:touch]">
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
            ) : conversationFiles.length > 0 || generatedArtifacts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-content">
                  {t("dashboard:chatWorkspace.workspacePreviewSelectTitle")}
                </p>
                <p className="text-[13px] leading-5 text-content-muted">
                  {t("dashboard:chatWorkspace.workspacePreviewSelectDesc")}
                </p>
                <div className="pt-2 space-y-2">
                  {generatedArtifacts.map((artifact) => (
                    <button
                      key={artifact.path}
                      type="button"
                      disabled={!isGeneratedArtifactPreviewable(artifact)}
                      onClick={() => onPreviewGeneratedArtifact?.(getGeneratedArtifactActionPath(artifact))}
                      className="flex w-full items-center gap-3 rounded-lg border border-outline bg-surface-muted p-2 text-left transition-colors hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/10"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-content-secondary">{artifact.name}</span>
                      <span className="text-[10px] text-content-muted">{t(`dashboard:chatWorkspace.workspaceGeneratedArtifactStatus_${artifact.status}`)}</span>
                      <Image className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                  ))}
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
          {expandedHtmlPreview}
    </>
  );
}
