import { Activity, ChevronDown, ChevronUp, Clock, Cpu, Database, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import type { AgentInstance, InstanceStats } from "../../types";

type RuntimeMetricsPanelProps = {
  instance: AgentInstance;
  statusLower: string;
  stats: InstanceStats & { loading: boolean };
  showMetricsDetails: boolean;
  setShowMetricsDetails: (value: boolean) => void;
};

const DETECTING_TEXT = String.fromCharCode(26816, 27979, 20013);
const UNAVAILABLE_TEXT = String.fromCharCode(26242, 19981, 21487, 29992);

export function RuntimeMetricsPanel({
  instance,
  statusLower,
  stats,
  showMetricsDetails,
  setShowMetricsDetails
}: RuntimeMetricsPanelProps) {
  const { t } = useTranslation("dashboard");

  let uptimeSeconds = 0;
  let hasUptime = false;
  let displayUptimeStr = "";
  let statusColor = "emerald";
  let statusText = t("runtimeMetrics.status.running");
  let isRunning = false;

  const isStorageExceeded = stats.storageStatus === "exceeded" || stats.storageExceeded === true || instance.physical_status === "storage_exceeded";
  const isStopped = statusLower === "stopped" || instance.physical_status === "exited";
  const runningStates = new Set(["running", "partial_running", "unhealthy", "gateway_ready", "dashboard_ready", "container_starting", "gateway_starting"]);

  const metricsShowRunning = (typeof stats.memory === "number" && stats.memory > 0) || (stats as any).isRunning === true;

  if (!isStorageExceeded && (runningStates.has(statusLower) || metricsShowRunning)) {
    isRunning = true;
  }

  const isDetectingMetric = (value: unknown) => String(value || "") === DETECTING_TEXT;
  const formatMetricValue = (value: unknown, suffix = "") => {
    if (typeof value === "number") return `${value}${suffix}`;
    const text = String(value || "");
    if (!text || text === DETECTING_TEXT) return t("runtimeMetrics.detecting");
    if (text === UNAVAILABLE_TEXT) return t("runtimeMetrics.unavailable");
    return text;
  };

  if (isStorageExceeded) {
    displayUptimeStr = t("runtimeMetrics.status.paused");
    statusText = t("runtimeMetrics.status.storageExceeded");
    statusColor = "rose";
  } else if (!isRunning) {
    const startupStatesSet = new Set(["creating", "restarting"]);
    if (startupStatesSet.has(statusLower)) {
      displayUptimeStr = t("runtimeMetrics.status.starting");
      statusText = t("runtimeMetrics.status.waitingContainer");
      statusColor = "blue";
    } else if (stats.loading || isDetectingMetric(stats.cpu)) {
      displayUptimeStr = t("runtimeMetrics.unavailable");
      statusText = t("runtimeMetrics.status.syncing");
      statusColor = "slate";
    } else {
      displayUptimeStr = t("runtimeMetrics.status.stopped");
      statusText = t("runtimeMetrics.status.notRunning");
      statusColor = "slate";
    }
  } else {
    const startTimeToUse = instance.started_at || stats.dockerStartedAt;
    if (startTimeToUse) {
      const startMs = new Date(startTimeToUse).getTime();
      const nowMs = Date.now();
      uptimeSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));

      if (!Number.isNaN(uptimeSeconds) && uptimeSeconds >= 0) {
        hasUptime = true;
        displayUptimeStr = uptimeSeconds >= 3600
          ? t("runtimeMetrics.duration.hms", {
              hours: Math.floor(uptimeSeconds / 3600),
              minutes: Math.floor((uptimeSeconds % 3600) / 60),
              seconds: uptimeSeconds % 60
            })
          : t("runtimeMetrics.duration.ms", {
              minutes: Math.floor(uptimeSeconds / 60),
              seconds: uptimeSeconds % 60
            });
      }
    }

    if (hasUptime) {
      const startupStates = new Set(["dashboard_ready", "gateway_ready", "container_starting", "gateway_starting"]);
      if (startupStates.has(statusLower)) {
        displayUptimeStr = t("runtimeMetrics.status.startedPrefix", { duration: displayUptimeStr });
      } else if (statusLower === "unhealthy") {
        displayUptimeStr = t("runtimeMetrics.status.abnormalStarted", { duration: displayUptimeStr });
        statusColor = "amber";
        statusText = t("runtimeMetrics.status.abnormal");
      }
    } else {
      displayUptimeStr = t("runtimeMetrics.unavailable");
      statusText = t("runtimeMetrics.status.syncing");
      statusColor = "slate";
    }
  }

  const numericCpu = typeof stats.cpu === "number" ? stats.cpu : 0;
  const numericMem = typeof stats.memory === "number" ? stats.memory : 0;

  const formatBytes = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined) return "--";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="bg-surface border border-outline/40 rounded-2xl p-4 shadow-xs text-left mt-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-content-secondary font-medium">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-brand-500 shrink-0" />
            <span className="font-semibold text-content-secondary">{t("runtimeMetrics.title")}</span>
          </div>
          <div className="w-px h-3 bg-outline shrink-0" />

          <div className="flex items-center gap-1 font-mono text-[11px]">
            <span className="text-content-muted">CPU:</span>
            <span className="font-semibold text-content-secondary">{formatMetricValue(stats.cpu, "%")}</span>
          </div>
          <div className="w-px h-3 bg-outline shrink-0" />

          <div className="flex items-center gap-1 font-mono text-[11px]">
            <span className="text-content-muted">{t("runtimeMetrics.memoryShort")}:</span>
            <span className="font-semibold text-content-secondary">{typeof stats.memory === "number" ? `${stats.memory} MB` : formatMetricValue(stats.memory)}</span>
          </div>
          <div className="w-px h-3 bg-outline shrink-0" />

          <div className="flex items-center gap-1 font-mono text-[11px]">
            <span className="text-content-muted">{t("runtimeMetrics.storageShort")}:</span>
            <span className="font-semibold text-content-secondary">
              {stats.storageStatus === "unknown" || stats.storageUsedBytes === null
                ? t("runtimeMetrics.unknown")
                : `${stats.storageUsagePercent !== null && stats.storageUsagePercent !== undefined ? `${stats.storageUsagePercent}%` : "--"}`}
            </span>
          </div>
          <div className="w-px h-3 bg-outline shrink-0" />

          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-content-muted">{t("runtimeMetrics.timeShort")}:</span>
            <span className="font-semibold text-content-secondary truncate max-w-[120px]" title={displayUptimeStr}>{displayUptimeStr}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowMetricsDetails(!showMetricsDetails); }}
          className="flex items-center gap-1 px-2.5 py-1 bg-control-hover hover:bg-surface-muted text-content-secondary rounded-lg text-[11px] font-semibold border border-outline/60 transition-all shrink-0 cursor-pointer"
        >
          <span>{showMetricsDetails ? t("runtimeMetrics.hideMetrics") : t("runtimeMetrics.showCharts")}</span>
          {showMetricsDetails ? <ChevronUp className="w-3.5 h-3.5 text-content-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-content-muted" />}
        </button>
      </div>

      {showMetricsDetails && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-outline/80 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex flex-col p-4 rounded-2xl border border-outline/40 bg-surface shadow-sm min-h-[120px]">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted mb-2">
              <Cpu className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="whitespace-nowrap">{t("runtimeMetrics.cpuLoad")}</span>
            </div>
            <div className="text-xl font-semibold text-content mb-auto">
              {formatMetricValue(stats.cpu, "%")}
            </div>
            <div className="mt-3">
              <div className="w-full bg-control-hover rounded-full h-2 overflow-hidden">
                <div
                  className={cn("bg-blue-500 h-full rounded-full transition-all duration-500", stats.loading && "animate-pulse")}
                  style={{ width: typeof stats.cpu === "number" ? `${Math.min(numericCpu * 3, 100)}%` : "25%" }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col p-4 rounded-2xl border border-outline/40 bg-surface shadow-sm min-h-[120px]">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted mb-2">
              <Database className="w-4 h-4 text-purple-500 shrink-0" />
              <span className="whitespace-nowrap">{t("runtimeMetrics.memoryUsage")}</span>
            </div>
            <div className="text-xl font-semibold text-content mb-auto">
              {typeof stats.memory === "number" ? `${stats.memory} MB` : formatMetricValue(stats.memory)}
            </div>
            <div className="mt-3">
              <div className="w-full bg-control-hover rounded-full h-2 overflow-hidden">
                <div
                  className={cn("bg-purple-500 h-full rounded-full transition-all duration-500", stats.loading && "animate-pulse")}
                  style={{ width: typeof stats.memory === "number" ? `${Math.min((numericMem / 1024) * 100, 100)}%` : "25%" }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col p-4 rounded-2xl border border-outline/40 bg-surface shadow-sm min-h-[120px]">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-content-muted mb-2">
              <HardDrive className="w-4 h-4 text-sky-500 shrink-0" />
              <span className="whitespace-nowrap">{t("runtimeMetrics.storageSpace")}</span>
            </div>

            <div className="text-xl font-semibold text-content mb-auto">
              {stats.storageStatus === "unknown" || stats.storageUsedBytes === null ? (
                <span className="text-content-muted text-[12px] font-medium">{t("runtimeMetrics.statsUnavailable")}</span>
              ) : (
                `${formatBytes(stats.storageUsedBytes)} / ${stats.storageLimitBytes !== null && stats.storageLimitBytes !== undefined ? formatBytes(stats.storageLimitBytes) : t("runtimeMetrics.unlimited")}`
              )}
            </div>

            <div className="mt-3">
              {stats.storageStatus !== "unknown" && stats.storageUsedBytes !== null && stats.storageLimitBytes !== null && stats.storageLimitBytes !== undefined ? (
                <div className="space-y-1.5">
                  <div className="w-full bg-control-hover rounded-full h-2 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        stats.storageStatus === "exceeded" ? "bg-red-500" : stats.storageStatus === "warning" ? "bg-amber-500" : "bg-sky-500",
                        stats.loading && "animate-pulse"
                      )}
                      style={{ width: `${Math.min(stats.storageUsagePercent || 0, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[11px] font-semibold">
                    <span className={cn(stats.storageStatus === "exceeded" ? "text-red-500" : stats.storageStatus === "warning" ? "text-amber-500" : "text-content-muted")}>
                      {t("runtimeMetrics.usedPercent", { percent: stats.storageUsagePercent !== null && stats.storageUsagePercent !== undefined ? `${stats.storageUsagePercent}%` : "--" })}
                    </span>
                    {stats.storageStatus === "exceeded" && <span className="text-red-650 font-semibold">{t("runtimeMetrics.storageStatus.exceeded")}</span>}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-content-muted font-medium">
                  {stats.storageStatus === "unknown" || stats.storageUsedBytes === null
                    ? t("runtimeMetrics.statsUnavailable")
                    : stats.storageLimitBytes === null
                      ? t("runtimeMetrics.unlimited")
                      : t("runtimeMetrics.detecting")}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col p-4 rounded-2xl border border-outline/40 bg-surface shadow-sm min-h-[120px]">
            <div className="flex items-center justify-between text-[11px] font-semibold text-content-muted mb-2">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="whitespace-nowrap">{t("runtimeMetrics.uptime")}</span>
              </div>
              {stats.error && (
                <span className="text-[11px] text-red-500 font-sans font-semibold tracking-tight truncate max-w-[80px]" title={stats.error}>{t("runtimeMetrics.metricsLimited")}</span>
              )}
            </div>
            <div className="text-xl font-semibold text-content mb-auto leading-tight">
              {displayUptimeStr}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                statusColor === "emerald" && "bg-emerald-500 animate-pulse",
                statusColor === "rose" && "bg-rose-500",
                statusColor === "slate" && "bg-slate-400",
                statusColor === "amber" && "bg-amber-500 animate-pulse",
                statusColor === "blue" && "bg-blue-500 animate-pulse"
              )} />
              <span className={cn(
                statusColor === "emerald" && "text-emerald-600",
                statusColor === "rose" && "text-rose-600 font-semibold",
                statusColor === "slate" && "text-content-muted",
                statusColor === "amber" && "text-amber-600",
                statusColor === "blue" && "text-blue-600"
              )}>
                {statusText}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
