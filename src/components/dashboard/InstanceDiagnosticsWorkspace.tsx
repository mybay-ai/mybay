import { DiagnosticReportExport } from "./DiagnosticReportExport";
import React from "react";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, CheckCircle2, Clock3, KeyRound, Loader2, MinusCircle, RefreshCw, RotateCcw, Server, Settings2, ShieldCheck, Terminal } from "lucide-react";
import { api } from "../../lib/api";
import { Button, cn } from "../ui";
import { InstanceReadinessNotice } from "../instance-runtime/InstanceReadinessNotice";
import { isCompleteDiagnosticPass, settleTimedOutDiagnosticChecks, type DiagnosticCheckView, type DiagnosticRecoveryAction } from "./diagnosticPresentation";

type RecoveryAction = DiagnosticRecoveryAction;
type Props = {
  instanceId: string;
  instance: any;
  onOpenLogs?: () => void;
  onOpenSettings?: () => void;
  onOpenPasswordReset?: () => void;
  onRedeploy?: () => void | Promise<void>;
};
type Check = DiagnosticCheckView;

const RECOVERY_LABELS: Record<RecoveryAction, string> = {
  view_logs: "查看实时日志",
  open_instance_settings: "打开模型设置",
  open_channel_settings: "打开渠道设置",
  open_password_reset: "重置访问密码",
  redeploy: "重新部署",
};

function recoveryIcon(action: RecoveryAction) {
  if (action === "view_logs") return Terminal;
  if (action === "open_password_reset") return KeyRound;
  if (action === "redeploy") return RotateCcw;
  return Settings2;
}

function DiagnosticRow({ check, checking, disabled, onRecheck, onRecover }: { check: Check; checking: boolean; disabled: boolean; onRecheck: (code: string) => void; onRecover: (action: RecoveryAction) => void }) {
  const ok = check.status === "pass";
  const pending = check.status === "checking";
  const skipped = check.status === "not_applicable";
  const Icon = ok ? CheckCircle2 : pending ? Loader2 : skipped ? MinusCircle : AlertTriangle;
  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4 dark:border-slate-800">
      <div className="flex items-center gap-2 text-sm font-medium text-content-secondary">
        <Icon className={cn("h-4 w-4", ok ? "text-emerald-500" : pending ? "animate-spin text-blue-500" : skipped ? "text-slate-400" : check.status === "fail" ? "text-rose-500" : "text-amber-500")} />
        <span>{check.label}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-content-muted dark:bg-slate-800">{check.domain}</span>
      </div>
      <div className="sm:max-w-[68%] sm:text-right">
        <div className={cn("text-xs", ok || skipped ? "text-content-muted" : pending ? "text-blue-700 dark:text-blue-300" : check.status === "fail" ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300")}>{check.detail}</div>
        {check.reasonCode && <code className="mt-1 inline-block text-[10px] text-content-muted">{check.reasonCode}</code>}
        {check.suggestion && <div className="mt-1 text-[11px] leading-4 text-content-muted">建议：{check.suggestion}</div>}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
          {check.recoveryAction && (() => { const RecoveryIcon = recoveryIcon(check.recoveryAction); return <button type="button" onClick={() => onRecover(check.recoveryAction!)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300"><RecoveryIcon className="h-3 w-3" />{RECOVERY_LABELS[check.recoveryAction]}</button>; })()}
          {check.recheckable !== false && !skipped && (
            <button type="button" onClick={() => onRecheck(check.code)} disabled={disabled} className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-400">
              <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />{checking ? "检测中" : "重新检测此项"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function eventAdvice(code: string) {
  const suggestions: Record<string, string> = {
    PORT_CONFLICT: "端口被占用，重新部署时系统会自动尝试下一可用端口。",
    CONTAINER_MISSING: "Docker 容器已丢失，请重新部署该实例。",
    DEPLOYMENT_RETRY_EXHAUSTED: "自动恢复次数已用尽，请检查 Docker 和网络后手动重试。",
    CLEANUP_FAILED: "资源清理未完成，请检查 Docker 后再次注销。",
    DEPLOYMENT_CANCELLED: "部署已被取消；如仍需使用，请重新发起部署。",
  };
  return suggestions[code] || "请结合诊断项目和运行日志排查。";
}

export function InstanceDiagnosticsWorkspace(props: Props) {
  return <InstanceDiagnosticsContent key={props.instanceId} {...props} />;
}

function InstanceDiagnosticsContent({ instanceId, instance, onOpenLogs, onOpenSettings, onOpenPasswordReset, onRedeploy }: Props) {
  const { t } = useTranslation("dashboard");
  const [health, setHealth] = React.useState<any>(null);
  const [report, setReport] = React.useState<any>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [eventFilter, setEventFilter] = React.useState<"all" | "errors" | "success">("all");
  const [loading, setLoading] = React.useState(true);
  const [shareableReport, setShareableReport] = React.useState<unknown>(null);
  const [error, setError] = React.useState("");
  const [checkingCode, setCheckingCode] = React.useState<string | null>(null);
  const [pollDeadline, setPollDeadline] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());
  const [lastSuccessfulAt, setLastSuccessfulAt] = React.useState<string | null>(() => {
    try { return sessionStorage.getItem(`instance_diagnostics_last_success_${instanceId}`); } catch { return null; }
  });
  const hasLoadedRef = React.useRef(false);
  const healthCheckedAtRef = React.useRef<string | null>(null);
  const reconcileBaselineRef = React.useRef<string | null>(null);
  const manualReconcileRef = React.useRef(false);

  const requestSequence = React.useRef(0);
  const loadInFlight = React.useRef(false);
  React.useEffect(() => () => {
    requestSequence.current += 1;
    loadInFlight.current = false;
  }, []);
  const load = React.useCallback(async (trigger = false, checkCode?: string) => {
    if (!trigger && loadInFlight.current) return;
    const sequence = ++requestSequence.current;
    loadInFlight.current = true;
    if (trigger) setCheckingCode(checkCode || "ALL");
    else if (!hasLoadedRef.current) setLoading(true);
    setError("");
    try {
      if (trigger) {
        reconcileBaselineRef.current = healthCheckedAtRef.current;
        manualReconcileRef.current = true;
        await api.post(`/api/instances/${instanceId}/health-check`, {
          trigger_source: "diagnostics_panel",
          ...(checkCode ? { check_code: checkCode } : {}),
        });
        if (sequence !== requestSequence.current) return;
        setPollDeadline(Date.now() + 60_000);
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
      const [healthResult, diagnosticResult, eventResult] = await Promise.all([
        api.get(`/api/instances/${instanceId}/healthz`),
        api.get(`/api/instances/${instanceId}/diagnostics`),
        api.get(`/api/instances/${instanceId}/events?limit=100`),
      ]);
      if (sequence !== requestSequence.current) return;
      setShareableReport(diagnosticResult?.shareableReport ?? null);
      setHealth(healthResult);
      const nextCheckedAt = healthResult?.gateway_checked_at || null;
      healthCheckedAtRef.current = nextCheckedAt;
      if (manualReconcileRef.current && nextCheckedAt && nextCheckedAt !== reconcileBaselineRef.current) {
        manualReconcileRef.current = false;
        setPollDeadline(0);
      }
      setReport(diagnosticResult?.report || null);
      setEvents(Array.isArray(eventResult?.events) ? eventResult.events : []);
      hasLoadedRef.current = true;
    } catch (reason: any) {
      if (sequence !== requestSequence.current) return;
      setError(reason?.message || "诊断数据加载失败");
    } finally {
      if (sequence === requestSequence.current) {
        loadInFlight.current = false;
        setLoading(false);
        setCheckingCode(null);
      }
    }
  }, [instanceId]);

  React.useEffect(() => {
    let pendingCheck = "";
    try {
      pendingCheck = sessionStorage.getItem(`instance_diagnostics_pending_${instanceId}`) || "";
      if (pendingCheck) sessionStorage.removeItem(`instance_diagnostics_pending_${instanceId}`);
    } catch {}
    void load(!!pendingCheck, pendingCheck || undefined);
  }, [instanceId, load]);

  React.useEffect(() => {
    const handleRecheck = (event: Event) => {
      const detail = (event as CustomEvent<{ instanceId?: string; checkCode?: string }>).detail;
      if (detail?.instanceId === instanceId) void load(true, detail.checkCode);
    };
    window.addEventListener("mybay:diagnostics-recheck", handleRecheck);
    return () => window.removeEventListener("mybay:diagnostics-recheck", handleRecheck);
  }, [instanceId, load]);
  const rawChecks: Check[] = React.useMemo(() => report?.checks || [], [report]);
  const timedOut = pollDeadline > 0 && now >= pollDeadline;
  const checks: Check[] = settleTimedOutDiagnosticChecks(rawChecks, timedOut);
  const reconciling = pollDeadline > now;

  React.useEffect(() => {
    const hasUnsettledChecks = rawChecks.some((check) => check.status === "checking");
    if (hasUnsettledChecks && pollDeadline === 0) {
      setPollDeadline(Date.now() + 60_000);
      return;
    }
    if (!hasUnsettledChecks && !manualReconcileRef.current) {
      if (pollDeadline !== 0) setPollDeadline(0);
      if (isCompleteDiagnosticPass(report?.summary)) {
        const successfulAt = report.generatedAt || new Date().toISOString();
        setLastSuccessfulAt(successfulAt);
        try { sessionStorage.setItem(`instance_diagnostics_last_success_${instanceId}`, successfulAt); } catch {}
      }
      return;
    }
    if (Date.now() >= pollDeadline) {
      manualReconcileRef.current = false;
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void load(false);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [instanceId, load, pollDeadline, rawChecks, report]);
  const filteredEvents = events.filter((event) => {
    const status = String(event.status || "").toLowerCase();
    if (eventFilter === "errors") return ["failed", "error", "cancelled"].includes(status) || !!event.error_code;
    if (eventFilter === "success") return ["success", "completed", "running"].includes(status);
    return true;
  });


  const recover = async (action: RecoveryAction, checkCode?: string) => {
    if (action !== "view_logs") {
      try { sessionStorage.setItem(`instance_diagnostics_pending_${instanceId}`, checkCode || "CHAT_READINESS"); } catch {}
    }
    if (action === "view_logs") onOpenLogs?.();
    else if (action === "open_password_reset") onOpenPasswordReset?.();
    else if (action === "redeploy") {
      await onRedeploy?.();
      try { sessionStorage.removeItem(`instance_diagnostics_pending_${instanceId}`); } catch {}
      window.dispatchEvent(new CustomEvent("mybay:diagnostics-recheck", { detail: { instanceId, checkCode } }));
    }
    else onOpenSettings?.();
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-base font-semibold text-content"><Server className="h-4 w-4 text-indigo-500" />{t("instance_diagnostics_title")}</h3><p className="mt-1 text-xs text-content-muted">{t("instance_diagnostics_description")}</p></div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => void load(true)} disabled={!!checkingCode || reconciling} className="gap-2"><RefreshCw className={cn("h-4 w-4", (checkingCode === "ALL" || reconciling) && "animate-spin")} />{reconciling ? "正在对账" : "全部重新检测"}</Button></div>
        </div>
        <DiagnosticReportExport report={shareableReport} />
        {report?.generatedAt && <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-content-muted"><span>{t("instance_diagnostics_last_checked", { time: new Date(report.generatedAt).toLocaleString() })}</span><span>{t("instance_diagnostics_last_success", { time: lastSuccessfulAt ? new Date(lastSuccessfulAt).toLocaleString() : t("instance_diagnostics_no_success") })}</span>{timedOut && <span className="font-medium text-amber-600 dark:text-amber-400">{t("instance_diagnostics_timeout_settled")}</span>}</div>}
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
        <InstanceReadinessNotice instance={instance} onOpenLogs={onOpenLogs} onOpenSettings={onOpenSettings} />
        {report?.summary && <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><div className="rounded-lg bg-emerald-50 p-3 text-center text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">通过 {report.summary.passed}</div><div className="rounded-lg bg-blue-50 p-3 text-center text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{t("instance_diagnostics_summary_checking", { count: report.summary.checking })}</div><div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">警告 {report.summary.warnings}</div><div className="rounded-lg bg-rose-50 p-3 text-center text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">失败 {report.summary.failed}</div><div className="rounded-lg bg-slate-100 p-3 text-center text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t("instance_diagnostics_summary_not_applicable", { count: report.summary.notApplicable })}</div></div>}
        <div className="rounded-xl border border-slate-200 bg-white px-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">{checks.map((check) => <DiagnosticRow key={check.code} check={check} checking={checkingCode === check.code} disabled={!!checkingCode || reconciling} onRecheck={(code) => void load(true, code)} onRecover={(action) => void recover(action, check.code)} />)}</div>
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-semibold text-content"><Activity className="h-4 w-4 text-amber-500" />实例事件</h3><div className="flex rounded-lg border border-slate-200 p-1 text-xs dark:border-slate-700">{(["all", "errors", "success"] as const).map((filter) => <button key={filter} onClick={() => setEventFilter(filter)} className={cn("rounded-md px-3 py-1.5", eventFilter === filter ? "bg-slate-100 font-medium text-slate-800 dark:bg-slate-800 dark:text-white" : "text-content-muted")}>{filter === "all" ? "全部" : filter === "errors" ? "异常" : "成功"}</button>)}</div></div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {filteredEvents.length === 0 ? <div className="p-6 text-center text-sm text-content-muted">当前筛选条件下暂无事件</div> : filteredEvents.map((event) => <div key={event.id} className="flex gap-3 border-b border-slate-100 p-4 last:border-0 dark:border-slate-800">{["failed", "error"].includes(event.status) || event.error_code ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /> : ["success", "completed"].includes(event.status) ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-content">{event.step || event.action || "instance_event"}</span><span className="text-[11px] text-content-muted">{event.created_at ? new Date(event.created_at).toLocaleString() : ""}</span></div>{event.message && <p className="mt-1 break-words text-xs leading-5 text-content-muted">{event.message}</p>}{event.error_code && <><p className="mt-1 font-mono text-[11px] text-rose-600 dark:text-rose-400">{event.error_code}</p><p className="mt-1 text-[11px] text-content-muted">建议：{eventAdvice(event.error_code)}</p></>}</div></div>)}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-content-muted"><ShieldCheck className="h-3.5 w-3.5" />诊断保持只读，不会自动修改 Docker 或实例配置。</div>
      </div>
    </div>
  );
}
