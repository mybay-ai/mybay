import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function InstancePdfPreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useTranslation("dashboard");
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(640);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null); setPage(1); setError(""); setBusy(true);
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false; setBusy(false); setError(t("files_preview_render_failed"));
      void task?.destroy();
    }, 30000);
    void blob.arrayBuffer().then(data => {
      if (!active) return;
      task = getDocument({ data: new Uint8Array(data), isEvalSupported: false,
        cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
        maxImageSize: 16_000_000, canvasMaxAreaInBytes: 32_000_000 });
      task.onPassword = () => { if (active) { active = false; setBusy(false); setError(t("files_pdf_password")); void task?.destroy(); } };
      return task.promise.then(pdf => { if (active) { window.clearTimeout(timer); setDocument(pdf); } });
    }).catch(() => { if (active) { setBusy(false); setError(t("files_pdf_invalid")); } })
      .finally(() => { window.clearTimeout(timer); });
    return () => { active = false; window.clearTimeout(timer); void task?.destroy(); };
  }, [blob, t]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(160, entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    // A fresh canvas per render avoids reusing a canvas while a cancelled task
    // is still unwinding in the worker.
    const target = canvas.current;
    setBusy(true); setError("");
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false; render?.cancel(); setBusy(false); setError(t("files_preview_render_failed"));
    }, 30000);
    void document.getPage(page).then(async pdfPage => {
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = Math.min((width - 2) / base.width, 2) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const wanted = cssScale * ratio;
      const scale = Math.min(wanted, Math.sqrt(8_000_000 / (base.width * base.height)));
      const viewport = pdfPage.getViewport({ scale });
      target.width = Math.max(1, Math.floor(viewport.width)); target.height = Math.max(1, Math.floor(viewport.height));
      target.style.width = `${base.width * cssScale}px`; target.style.height = `${base.height * cssScale}px`;
      render = pdfPage.render({ canvas: target, viewport });
      await render.promise;
      if (active) setBusy(false);
    }).catch(() => { if (active) { setBusy(false); setError(t("files_pdf_invalid")); } })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); render?.cancel(); };
  }, [document, page, width, zoom, t]);

  const buttonClass = "min-h-11 rounded-lg border border-outline px-3 text-xs disabled:opacity-40";
  return <div ref={container} className="min-w-0 space-y-3">
    {document && <nav aria-label={t("files_pdf_navigation")} className="flex flex-wrap items-center gap-2 text-content">
      <button className={buttonClass} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t("files_pdf_previous")}</button>
      <span aria-live="polite" className="text-xs">{t("files_pdf_page_count", { page, count: document.numPages })}</span>
      <button className={buttonClass} disabled={page >= document.numPages} onClick={() => setPage(value => value + 1)}>{t("files_pdf_next")}</button>
      <button className={buttonClass} disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} aria-label={t("files_pdf_zoom_out")}>−</button>
      <button className={buttonClass} onClick={() => setZoom(1)}>{t("files_pdf_fit")}</button>
      <button className={buttonClass} disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + 0.25))} aria-label={t("files_pdf_zoom_in")}>+</button>
    </nav>}
    {busy && <p role="status" className="text-sm text-content-muted">{t("files_preview_loading")}</p>}
    {error && <p role="alert" className="text-sm text-amber-600">{error}</p>}
    <div className="overflow-auto" style={{ visibility: busy || error ? "hidden" : "visible" }}>
      <canvas key={`${page}:${width}:${zoom}:${Boolean(document)}`} ref={canvas} aria-label={`${name} — ${t("files_pdf_page_count", { page, count: document?.numPages || 1 })}`} role="img" className="mx-auto bg-white" />
    </div>
  </div>;
}
