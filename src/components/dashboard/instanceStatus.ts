import { AgentInstance } from "../../types";

type InstanceStatusLabel = {
  text: string;
  i18nKey?: string;
  color: string;
  textClass: string;
  detail?: string;
};

const runningLabel = (inst: AgentInstance): InstanceStatusLabel => {
  const channel = inst.configSummary?.channel || "web";
  const isPureWeb = channel === "web" || channel === "none";
  return isPureWeb
    ? { text: "运行中", i18nKey: "instanceStatus.running", color: "bg-green-500", textClass: "text-emerald-700 bg-emerald-50 border-emerald-250 font-medium" }
    : { text: "通道已就绪", i18nKey: "instanceStatus.channelReady", color: "bg-green-500", textClass: "text-emerald-700 bg-emerald-50 border-emerald-250 font-medium" };
};
const cleanupStepLabels: Record<string, string> = {
  queued: "等待清理",
  cleanup_started: "正在准备清理",
  cleaning_container: "正在停止并删除容器",
  cleaning_network: "正在清理 Docker 网络",
  releasing_port: "正在释放端口",
  removing_files: "正在删除实例数据",
  cleanup_retry_wait: "清理失败，等待自动重试",
  cleanup_failed: "清理失败",
};

export function getCleanupStatusPresentation(inst: AgentInstance): { text: string; detail?: string } | null {
  const status = String(inst.cleanupStatus || "");
  const step = String(inst.cleanupStep || "");
  if (!status && !["deleting", "archiving", "cleanup_failed"].includes(String(inst.status))) return null;

  const error = String(inst.cleanupErrorMessage || "").trim();
  if (status === "failed" || inst.status === "cleanup_failed") {
    return { text: "清理失败", detail: error || "请查看部署事件后重试。" };
  }
  if (status === "retry_wait") {
    let retryText = "清理失败，等待自动重试";
    if (inst.cleanupNextRetryAt) {
      const seconds = Math.max(0, Math.ceil((new Date(inst.cleanupNextRetryAt).getTime() - Date.now()) / 1000));
      retryText += "（约 " + seconds + " 秒后）";
    }
    return { text: retryText, detail: error || undefined };
  }
  if (step && cleanupStepLabels[step]) return { text: cleanupStepLabels[step] };
  if (status === "queued") return { text: "等待清理" };
  if (status === "cleaning") return { text: "正在清理运行资源" };
  if (inst.status === "archiving") return { text: "正在归档并清理运行资源" };
  return { text: "正在删除实例资源" };
}


export const getRefinedStatusLabel = (inst: AgentInstance): InstanceStatusLabel => {
  if (inst.archived) {
    return { text: "已归档", i18nKey: "instanceStatus.archived", color: "bg-indigo-500", textClass: "text-indigo-700 bg-indigo-50 border-indigo-200" };
  }

  const cleanup = getCleanupStatusPresentation(inst);
  if (cleanup) {
    const visibleText = cleanup.detail
      ? cleanup.text + "：" + cleanup.detail.slice(0, 48)
      : cleanup.text;
    return { text: visibleText, color: "bg-amber-500 animate-pulse", textClass: "text-amber-800 bg-amber-50 border-amber-200 font-medium", detail: cleanup.detail };
  }

  if (inst.configSummary?.storageExceeded) {
    return { text: "存储超额 (已暂停)", i18nKey: "instanceStatus.storageExceeded", color: "bg-red-500", textClass: "text-rose-700 bg-rose-50 border-rose-200 font-bold animate-pulse" };
  }

  const statusLower = (inst.status || "").toLowerCase();
  const physicalStatus = (inst.physical_status || "").toLowerCase();
  const gatewayStatus = (inst.gateway_status || "").toLowerCase();

  if (statusLower === "deploying") {
    return { text: "部署中...", i18nKey: "instanceStatus.deploying", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  // Only an explicit restarting status should show the restarting label.
  if (statusLower === "restarting") {
    return { text: "重启中...", i18nKey: "instanceStatus.restarting", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  if (statusLower === "stopped") {
    return { text: "已暂停", i18nKey: "instanceStatus.stopped", color: "bg-slate-400", textClass: "text-slate-600 bg-slate-50 border-slate-200 font-medium" };
  }

  if (statusLower === "failed") {
    return { text: "部署失败", i18nKey: "instanceStatus.failed", color: "bg-red-500", textClass: "text-red-700 bg-red-50 border-red-200 font-medium" };
  }

  if (statusLower === "container_starting" || statusLower === "creating" || statusLower === "initializing") {
    return { text: "启动中...", i18nKey: "instanceStatus.starting", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  if (statusLower === "gateway_starting") {
    return { text: "构建中...", i18nKey: "instanceStatus.gatewayStarting", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  if (statusLower === "gateway_syncing") {
    return { text: "路由同步中", i18nKey: "instanceStatus.gatewaySyncing", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  const routeStillSyncing =
    (statusLower === "running" || statusLower === "gateway_ready" || statusLower === "dashboard_ready" || physicalStatus === "running") &&
    inst.gateway_ready === false &&
    (gatewayStatus === "" || gatewayStatus === "starting" || gatewayStatus === "syncing" || gatewayStatus === "pending");

  if (routeStillSyncing) {
    return { text: "路由同步中", i18nKey: "instanceStatus.gatewaySyncing", color: "bg-blue-500 animate-pulse", textClass: "text-blue-700 bg-blue-50 border-blue-200 animate-pulse font-medium" };
  }

  const isPhysicallyRunning = physicalStatus === "running" || statusLower === "running" || statusLower === "gateway_ready";

  if (isPhysicallyRunning) {
    // Keep the top-level badge stable. Stale gateway_error/gateway_status values can remain after
    // a transient probe failure, while the container and user-facing channel are already healthy.
    // Detailed gateway/model/channel problems are shown in the health diagnostics card instead.
    return runningLabel(inst);
  }

  if (statusLower === "dashboard_ready") {
    return { text: "控制台已就绪", i18nKey: "instanceStatus.dashboardReady", color: "bg-amber-500 animate-pulse", textClass: "text-amber-700 bg-amber-50 border-amber-200 animate-pulse font-medium" };
  }

  if (statusLower === "partial_running") {
    return { text: "部分启动", i18nKey: "instanceStatus.partialRunning", color: "bg-amber-500", textClass: "text-amber-700 bg-amber-50 border-amber-200 font-medium" };
  }

  if (statusLower === "unhealthy") {
    return { text: "运行异常", i18nKey: "instanceStatus.unhealthy", color: "bg-red-500", textClass: "text-red-700 bg-red-50 border-red-200 font-medium" };
  }

  return { text: inst.status?.toUpperCase() || "UNKNOWN", color: "bg-slate-400", textClass: "text-slate-600 bg-slate-50 border-slate-200 font-medium" };
};
