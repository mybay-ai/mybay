import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { readLocalDiagnosticExport } from "../../../shared/localDiagnosticExport";
import { Button } from "../ui";

export function DiagnosticReportExport({ report }: { report: unknown }) {
  const { t } = useTranslation("dashboard");
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const safe = readLocalDiagnosticExport(report);
  const open = () => { setNotice(""); setPreview(safe ? JSON.stringify(safe, null, 2) : null); };
  const download = () => {
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "mybay-diagnostic.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview); setNotice(t("diagnosticExport.copied")); }
    catch { setNotice(t("diagnosticExport.copyFailed")); }
  };
  return <div className="w-full">
    <Button variant="outline" disabled={!safe} onClick={open}>{t("diagnosticExport.open")}</Button>
    {preview !== null && <section aria-label={t("diagnosticExport.title")} className="mt-3 rounded-xl border border-outline bg-surface p-4">
      <h4 className="font-semibold">{t("diagnosticExport.title")}</h4>
      <p className="my-2 text-xs text-content-muted">{t("diagnosticExport.privacy")}</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-muted p-3 text-xs">{preview}</pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={download}>{t("diagnosticExport.download")}</Button>
        <Button variant="outline" onClick={() => void copy()}>{t("diagnosticExport.copy")}</Button>
        <Button variant="outline" onClick={() => { setPreview(null); setNotice(""); }}>{t("diagnosticExport.close")}</Button>
      </div>
      {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    </section>}
  </div>;
}
