import React from "react";
import { Activity, AlertTriangle, CheckCircle2, ClipboardCopy, Clock3, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { Button, cn } from "../ui";

type Props = { instanceId: string; instance: any };
type Check = { code: string; label: string; status: "pass" | "warning" | "fail"; detail: string; suggestion?: string };

function DiagnosticRow({ check }: { check: Check }) {
  const ok = check.status === "pass";
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
      <div className="flex items-center gap-2 text-sm font-medium text-content-secondary">
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className={cn("h-4 w-4", check.status === "fail" ? "text-rose-500" : "text-amber-500")} />}
        {check.label}
      </div>
      <div className="max-w-[65%] text-right">
        <div className={cn("text-xs", ok ? "text-content-muted" : check.status === "fail" ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300")}>{check.detail}</div>
        {check.suggestion && <div className="mt-1 text-[11px] leading-4 text-content-muted">建议：{check.suggestion}</div>}
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

export function InstanceDiagnosticsWorkspace({ instanceId }: Props) {
  const [health, setHealth] = React.useState<any>(null);
  const [report, setReport] = React.useState<any>(null);
  const [events, setEvents] = React.useState<any[]>([]);
  const [eventFilter, setEventFilter] = React.useState<"all" | "errors" | "success">("all");
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async (trigger = false) => {
    setLoading(true);
    setError("");
    try {
      if (trigger) await api.post(`/api/instances/${instanceId}/health-check`, { trigger_source: "diagnostics_panel" });
      const [healthResult, diagnosticResult, eventResult] = await Promise.all([
        api.get(`/api/instances/${instanceId}/healthz`),
        api.get(`/api/instances/${instanceId}/diagnostics`),
        api.get(`/api/instances/${instanceId}/events?limit=100`),
      ]);
      setHealth(healthResult);
      setReport(diagnosticResult?.report || null);
      setEvents(Array.isArray(eventResult?.events) ? eventResult.events : []);
    } catch (reason: any) {
      setError(reason?.message || "诊断数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  React.useEffect(() => { void load(false); }, [load]);

  const supplementalChecks: Check[] = [
    { code: "GATEWAY", label: "Agent 网关", status: health?.gateway_ready ? "pass" : "fail", detail: health?.gateway_error || health?.gateway?.status || "尚未就绪", suggestion: health?.gateway_ready ? undefined : "查看运行日志，确认容器已启动且网关端口能够响应。" },
    { code: "ACCESS_AUTH", label: "访问保护", status: health?.dashboard?.isAuthConfigured ? "pass" : "fail", detail: health?.dashboard?.isAuthConfigured ? "认证配置完整" : "认证配置缺失或尚未生效", suggestion: health?.dashboard?.isAuthConfigured ? undefined : "在实例操作菜单中重置访问密码，使认证配置重新写入。" },
    { code: "MODEL", label: "模型配置", status: ["verified", "verified_by_runtime_session"].includes(health?.model?.config_status) ? "pass" : "warning", detail: `${health?.model?.config_status || "unknown"} / ${health?.model?.runtime_status || "unknown"}`, suggestion: ["verified", "verified_by_runtime_session"].includes(health?.model?.config_status) ? undefined : "重新测试模型连接，并确认保存的凭据、模型名和 Base URL 一致。" },
  ];
  const checks: Check[] = [...(report?.checks || []), ...supplementalChecks];
  const filteredEvents = events.filter((event) => {
    const status = String(event.status || "").toLowerCase();
    if (eventFilter === "errors") return ["failed", "error", "cancelled"].includes(status) || !!event.error_code;
    if (eventFilter === "success") return ["success", "completed", "running"].includes(status);
    return true;
  });

  const copyReport = async () => {
    const payload = { ...report, health: { gateway_ready: health?.gateway_ready, gateway_error: health?.gateway_error, dashboard_online: health?.dashboard?.online, auth_configured: health?.dashboard?.isAuthConfigured, model: health?.model }, recentEvents: events.slice(0, 20) };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-base font-semibold text-content"><Server className="h-4 w-4 text-indigo-500" />容器诊断</h3><p className="mt-1 text-xs text-content-muted">只读检查容器、端口、网络、磁盘、网关、认证和模型状态。</p></div>
          <div className="flex gap-2"><Button variant="outline" onClick={() => void copyReport()} disabled={!report} className="gap-2"><ClipboardCopy className="h-4 w-4" />{copied ? "已复制" : "复制诊断报告"}</Button><Button variant="outline" onClick={() => void load(true)} disabled={loading} className="gap-2"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />重新检测</Button></div>
        </div>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>}
        {report?.summary && <div className="grid grid-cols-3 gap-3"><div className="rounded-lg bg-emerald-50 p-3 text-center text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">通过 {report.summary.passed}</div><div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">警告 {report.summary.warnings}</div><div className="rounded-lg bg-rose-50 p-3 text-center text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">失败 {report.summary.failed}</div></div>}
        <div className="rounded-xl border border-slate-200 bg-white px-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">{checks.map((check) => <DiagnosticRow key={check.code} check={check} />)}</div>
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
