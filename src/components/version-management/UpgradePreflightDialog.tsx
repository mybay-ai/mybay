import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card, cn } from "../ui";

export function UpgradePreflightDialog({ open, loading, report, onClose, onConfirm }: any) {
  const { t } = useTranslation("dashboard");
  if (!open) return null;
  const reports = report?.reports || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm" onClick={onClose}>
      <Card className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-outline bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-outline p-4 sm:p-5">
          <div><h2 className="font-black text-content">{t("versionRepository.preflight.title")}</h2><p className="mt-1 text-[13px] text-content-muted">{t("versionRepository.preflight.subtitle")}</p></div>
          <button onClick={onClose} title={t("versionRepository.preflight.cancel")} className="rounded-lg p-1.5 text-content-muted hover:bg-surface-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {loading ? <div className="flex min-h-56 flex-col items-center justify-center text-content-muted"><Loader2 className="mb-3 h-7 w-7 animate-spin text-blue-600" /><span>{t("versionRepository.preflight.loading")}</span></div> : reports.map((item: any) => (
            <section key={item.instanceId} className="rounded-2xl border border-outline bg-surface-muted/40 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate font-bold text-content">{item.instanceName}</div><div className="truncate font-mono text-[11px] text-content-muted">{item.instanceId} → {item.targetTag}</div></div><span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", item.allowed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>{t(item.allowed ? "versionRepository.preflight.ready" : "versionRepository.preflight.blocked")}</span></div>
              <div className="grid gap-2 sm:grid-cols-2">
                {item.checks.map((check: any) => <div key={check.code} className={cn("flex items-start gap-2 rounded-xl border bg-surface px-3 py-2.5", check.status === "blocker" ? "border-red-200" : check.status === "warning" ? "border-amber-200" : "border-outline")}>
                  {check.status === "pass" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : check.status === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                  <div className="min-w-0"><div className="text-[12px] font-bold text-content-secondary">{t(`versionRepository.preflight.checks.${check.code}`)}</div><p className="mt-0.5 text-[11px] leading-relaxed text-content-muted">{t(`versionRepository.preflight.statuses.${check.status}`)}</p></div>
                </div>)}
              </div>
            </section>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline p-4"><div className="text-[12px] text-content-muted">{report ? String(t("versionRepository.preflight.summary", report.summary)) : ""}</div><div className="flex gap-2"><Button variant="outline" onClick={onClose}>{t("versionRepository.preflight.cancel")}</Button><Button onClick={onConfirm} disabled={loading || !report?.allowed} className="bg-blue-600 text-white disabled:opacity-50">{t(report?.allowed ? "versionRepository.preflight.confirm" : "versionRepository.preflight.resolveBlockers")}</Button></div></div>
      </Card>
    </div>
  );
}
