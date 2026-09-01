import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HTML_PREVIEW_IFRAME_SANDBOX } from "./chat-workspace/previewSecurity";
import { loadInstancePreview, type InstancePreview } from "../lib/instanceFilePreview";
import type { InstanceFileItem } from "../lib/instanceFiles";

const InstancePdfPreview = lazy(() => import("./InstancePdfPreview"));

export function InstanceFilePreview({ instanceId, file, onClose, onDownload }: {
  instanceId: string;
  file: InstanceFileItem;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const [preview, setPreview] = useState<InstancePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<"page" | "source">("page");
  const [expanded, setExpanded] = useState(false);
  const [assetStatus, setAssetStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | undefined;
    setLoading(true); setError(null); setPreview(null); setAssetStatus("loading");
    void loadInstancePreview(instanceId, file, controller.signal).then(result => {
      if (!active) return;
      if (result.blob && result.kind !== "pdf") objectUrl = URL.createObjectURL(result.blob);
      setPreview({ ...result, url: objectUrl || result.url });
      if (result.pageError) setMode("source");
    }).catch(reason => {
      if (!active) return;
      setError(reason.code === "PREVIEW_TOO_LARGE" ? t("files_preview_too_large") : reason.message || t("files_preview_load_failed"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [instanceId, file.path, revision, t]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); expanded ? setExpanded(false) : onClose(); }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [expanded, onClose]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);

  useEffect(() => {
    if (!preview || assetStatus !== "loading" || !["html", "office", "image", "video", "audio"].includes(preview.kind) || mode === "source") return;
    const timer = window.setTimeout(() => setAssetStatus("error"), 20000);
    return () => window.clearTimeout(timer);
  }, [preview, assetStatus, mode]);

  const actionClass = "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-outline bg-surface px-3 text-xs text-content-secondary hover:bg-surface-muted";
  const frameClass = "w-full h-full min-h-[380px] border-0 bg-white";
  const ready = () => setAssetStatus("ready");
  const failed = () => setAssetStatus("error");
  const reload = () => { setMode("page"); setRevision(value => value + 1); };
  const content = (
    <section role="dialog" aria-label={t("files_preview_title") + ": " + file.name} aria-modal={expanded || undefined}
      className={expanded ? "fixed inset-2 z-[10050] flex flex-col overflow-hidden rounded-xl border border-outline bg-surface shadow-2xl" : "absolute inset-0 z-50 flex flex-col overflow-hidden bg-surface"}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-outline p-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-content" title={file.name}>{file.name}</h3>
        <div className="flex flex-wrap gap-1">
          <button className={actionClass} onClick={reload} aria-label={t("files_preview_retry")} title={t("files_preview_retry")}><RefreshCw className="h-4 w-4" /></button>
          <button className={actionClass} onClick={() => setExpanded(value => !value)} aria-label={t(expanded ? "files_preview_collapse" : "files_preview_expand")} title={t(expanded ? "files_preview_collapse" : "files_preview_expand")}>{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
          <button className={actionClass} onClick={onDownload} aria-label={t("files_download_title")} title={t("files_download_title")}><Download className="h-4 w-4" /></button>
          <button autoFocus className={actionClass} onClick={onClose} aria-label={t("files_close_preview_title")} title={t("files_close_preview_title")}><X className="h-4 w-4" /></button>
        </div>
      </header>
      {(preview?.kind === "html" || preview?.kind === "markdown") && <div className="flex flex-wrap gap-2 border-b border-outline p-3">
        <button className={actionClass} aria-pressed={mode === "page"} disabled={Boolean(preview.pageError)} onClick={() => setMode("page")}>{t("files_preview_page")}</button>
        <button className={actionClass} aria-pressed={mode === "source"} onClick={() => setMode("source")}>{t("files_preview_source")}</button>
        {preview.kind === "html" && <p className="w-full text-xs text-content-muted">{t("files_preview_html_hint")}</p>}
      </div>}
      {preview?.pageError && <p role="alert" className="px-3 py-2 text-xs text-amber-600">{preview.pageError === "HTML_PREVIEW_DEPENDENCIES_MISSING" ? t("files_preview_dependencies") : t("files_preview_page_failed")} {t("files_preview_source_available")}</p>}
      {preview?.kind === "office" && <p className="px-3 py-2 text-xs text-content-muted">{t("files_preview_office_hint")}{preview.truncated && ` ${t("files_preview_truncated")}`}</p>}
      {preview?.kind === "pdf" && <p className="px-3 py-2 text-xs text-content-muted">{t("files_preview_pdf_hint")}</p>}
      {!loading && !error && preview && mode === "page" && assetStatus === "error" && <p role="alert" className="px-3 py-2 text-xs text-amber-600">{t("files_preview_render_failed")}</p>}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? <div role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-content-muted"><RefreshCw className="h-5 w-5 animate-spin" />{t("files_preview_loading")}</div>
          : error ? <div role="alert" className="space-y-4 py-10 text-center text-sm text-content-muted"><p>{error}</p><button className={actionClass} onClick={reload}>{t("files_preview_retry")}</button></div>
          : !preview || preview.kind === "unsupported" ? <p className="py-10 text-center text-sm text-content-muted">{t("files_preview_unsupported")}</p>
          : mode === "source" || preview.kind === "text" ? <pre className="h-full overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-muted p-4 text-xs text-content-secondary">{preview.text || t("files_empty_file")}</pre>
          : preview.kind === "markdown" ? <article className="prose prose-sm dark:prose-invert max-w-none break-words [&_table]:block [&_table]:overflow-auto"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
              img: ({ alt }) => <span>{t("files_preview_image_omitted", { name: alt || "" })}</span>,
              a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
            }}>{preview.text || t("files_empty_file")}</Markdown></article>
          : preview.kind === "image" ? <img src={preview.url} alt={file.name} onLoad={ready} onError={failed} className="mx-auto max-h-full max-w-full object-contain" />
          : preview.kind === "pdf" && preview.blob ? <Suspense fallback={<p role="status">{t("files_preview_loading")}</p>}><InstancePdfPreview blob={preview.blob} name={file.name} /></Suspense>
          : preview.kind === "office" ? <iframe title={file.name} srcDoc={preview.officeHtml} sandbox="" referrerPolicy="no-referrer" onLoad={ready} onError={failed} className={frameClass} />
          : preview.kind === "html" ? <iframe title={file.name} src={preview.url} sandbox={HTML_PREVIEW_IFRAME_SANDBOX} referrerPolicy="no-referrer" onLoad={ready} onError={failed} className={frameClass} />
          : preview.kind === "audio" ? <audio aria-label={file.name} src={preview.url} controls preload="metadata" onLoadedMetadata={ready} onError={failed} className="w-full" />
          : <video aria-label={file.name} src={preview.url} controls playsInline preload="metadata" onLoadedMetadata={ready} onError={failed} className="max-h-full w-full rounded-lg bg-black" />}
      </div>
    </section>
  );
  return expanded ? createPortal(content, document.body) : content;
}
