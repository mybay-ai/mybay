import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Square, Play, RefreshCw, AlertTriangle, Terminal, Check, ChevronDown, ChevronUp, Folder } from "lucide-react";
import { Button } from "./ui";
import { cn } from "../lib/utils";
import type { AgentInstance, InstanceStats } from "../types";
import { ChannelPendingAuthPanel } from "./ChannelPendingAuthPanel";
import { useFeedback } from "./FeedbackProvider";
import { RuntimeMetricsPanel } from "./instance-runtime/RuntimeMetricsPanel";

import { api } from "../lib/api";

export function ContainerStats({ instance: propInstance, onReload, currentUser, onOpenSettings, onViewGuide, onViewFiles, isMobile = false }: { instance: AgentInstance, onReload: () => void, currentUser: any, onOpenSettings?: () => void, onViewGuide?: (guideId: string) => void, onViewFiles?: () => void, isMobile?: boolean }) {
  const { t, i18n } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [instance, setInstance] = useState<AgentInstance>(propInstance);

  useEffect(() => {
    setInstance(propInstance);
  }, [propInstance]);

  useEffect(() => {
    const handleLocalUpdate = (e: any) => {
      const detail = e.detail;
      if (detail && detail.instanceId === propInstance.id) {
        setInstance(prev => ({
          ...prev,
          connected_channels: detail.connectedCount,
          configured_channels: detail.totalCount,
          channel_status: detail.channelStatus,
          gateway_ready: detail.gatewayReady ?? prev.gateway_ready
        }));
      }
    };

    window.addEventListener("instance-channel-updated" as any, handleLocalUpdate);
    return () => {
      window.removeEventListener("instance-channel-updated" as any, handleLocalUpdate);
    };
  }, [propInstance.id]);

  const statusLower = (instance.status || '').toLowerCase();
  const [stats, setStats] = useState<InstanceStats & { loading: boolean }>({
    cpu: t("instance_metric_checking"),
    memory: t("instance_metric_checking"),
    uptime: 0,
    dockerStartedAt: null,
    isRunning: false,
    storageUsedBytes: null,
    storageLimitBytes: null,
    storageUsagePercent: null,
    storageStatus: "unknown",
    loading: true,
    error: null
  });
  const [rechecking, setRechecking] = useState(false);
  const [showConfigSummary, setShowConfigSummary] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showMoreMaintenance, setShowMoreMaintenance] = useState(false);
  const [showAccessDetails, setShowAccessDetails] = useState(false);
  const [showMetricsDetails, setShowMetricsDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const getSubdomain = (urlStr: string) => {
    try {
      const url = new URL(urlStr);
      return url.hostname;
    } catch (e) {
      return urlStr || "hermes-agent.your-domain.com";
    }
  };

  const formatStorageQuotaLabel = (bytes?: number | null) => {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "--";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024 && Math.abs(mb % 1024) < 0.01) return Math.round(mb / 1024) + "GB";
    if (mb >= 1024) return Number((mb / 1024).toFixed(1)) + "GB";
    return Math.round(mb) + "MB";
  };

  const handleRecheckHealth = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRechecking(true);
    try {
      await api.post(`/api/instances/${instance.id}/health-check`, { trigger_source: 'manual' });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => {
        setRechecking(false);
        onReload();
      }, 1500);
    }
  };

  useEffect(() => {
    const fetchEligible = new Set([
      "creating",
      "container_starting",
      "dashboard_ready",
      "gateway_starting",
      "gateway_ready",
      "running",
      "partial_running",
      "unhealthy",
      "stopped"
    ]);

    if (!fetchEligible.has(statusLower)) {
      setStats({
        cpu: 0,
        memory: 0,
        uptime: 0,
        dockerStartedAt: null,
        loading: false,
        error: null
      });
      return;
    }

    let isVisibleInViewport = false;
    let isTabVisible = document.visibilityState === 'visible';
    let timerId: any = null;
    let hasLoadedOnce = false;

    const updateStatsAndCheck = async () => {
      // 1. Fetch metrics standard stats
      try {
        const data = await api.get(`/api/instances/${instance.id}/stats`);

        if (!data) {
          throw new Error(t("instance_stats_empty_response"));
        }

        if (data.error) {
          setStats({
            cpu: t("instance_metric_unavailable"),
            memory: t("instance_metric_unavailable"),
            uptime: 0,
            dockerStartedAt: data.dockerStartedAt || null,
            storageUsedBytes: null,
            storageLimitBytes: null,
            storageUsagePercent: null,
            storageStatus: "unknown",
            loading: false,
            error: data.message || data.error,
            accessBridgeCompatibility: data.accessBridgeCompatibility
          });
        } else {
          setStats({
            cpu: data.cpu !== undefined ? data.cpu : t("instance_metric_checking"),
            memory: data.memory !== undefined ? data.memory : t("instance_metric_checking"),
            uptime: 0,
            dockerStartedAt: data.dockerStartedAt || null,
            isRunning: data.isRunning || false,
            storageUsedBytes: data.storageUsedBytes,
            storageLimitBytes: data.storageLimitBytes,
            storageUsagePercent: data.storageUsagePercent,
            storageStatus: data.storageStatus || "unknown",
            storageExceeded: data.storageExceeded,
            loading: false,
            error: null,
            accessBridgeCompatibility: data.accessBridgeCompatibility
          });
        }
      } catch (err: any) {
        console.error("Failed to fetch custom stats:", err);
        setStats({
          cpu: t("instance_metric_unavailable"),
          memory: t("instance_metric_unavailable"),
          uptime: 0,
          dockerStartedAt: null,
          loading: false,
          error: err.message || t("instance_metrics_unavailable")
        });
      }
    };

    const resetInterval = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }

      // If page is hidden or element is out of viewport, suspend polling to save resources
      if (!isTabVisible || !isVisibleInViewport) {
        return;
      }

      // Dynamic refresh frequency:
      // If booting up (gateway_ready !== true), poll every 5s.
      // Else if expanded (showMetricsDetails is true), poll every 30s.
      // Else (collapsed):
      //   - on mobile (width < 768): poll every 90s (extremely friendly to network/CPU)
      //   - on desktop: poll every 60s
      let intervalMs = 45000;
      if (instance.gateway_ready !== true) {
        intervalMs = 5000;
      } else if (showMetricsDetails) {
        intervalMs = 30000;
      } else {
        intervalMs = isMobile ? 90000 : 60000;
      }

      timerId = setInterval(updateStatsAndCheck, intervalMs);
    };

    let active = true;
    let delayTimer: any = null;

    // IntersectionObserver to detect element visibility
    const observer = new IntersectionObserver(([entry]) => {
      if (!active) return;
      const becameVisible = !isVisibleInViewport && entry.isIntersecting;
      isVisibleInViewport = entry.isIntersecting;
      if (becameVisible && !hasLoadedOnce) {
        hasLoadedOnce = true;
        updateStatsAndCheck();
      }
      resetInterval();
    }, { threshold: 0.01 });

    // Delay observation slightly to ensure the browser has completed initial layout,
    // which prevents the first-mount intersection false-positives for off-screen cards.
    delayTimer = setTimeout(() => {
      if (containerRef.current && active) {
        observer.observe(containerRef.current);
      }
    }, 150);

    const handleVisibilityChange = () => {
      isTabVisible = document.visibilityState === 'visible';
      resetInterval();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial load and timer setup
    resetInterval();

    const handleCustomEvent = (e: any) => {
       if (e.detail?.instanceId === instance.id) {
          updateStatsAndCheck();
       }
    };
    window.addEventListener('mybay:stats-refresh', handleCustomEvent);

    return () => {
      active = false;
      if (delayTimer) clearTimeout(delayTimer);
      if (timerId) clearInterval(timerId);
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener('mybay:stats-refresh', handleCustomEvent);
    };
  }, [instance.id, instance.status, instance.gateway_ready, showMetricsDetails]);

  const handleAction = async (action: string, e: React.MouseEvent, requireConfirm: boolean = false, confirmMsg: string = "") => {
    e.stopPropagation();
    if (requireConfirm) {
      const confirmed = await showConfirm({
        title: action === "redeploy" ? t("confirm_redeploy_title") : t("confirm_action_title"),
        message: confirmMsg || t("confirm_action_default"),
        type: action === "redeploy" ? "danger" : "warning",
        confirmText: t("confirm_ok"),
        cancelText: t("action_cancel")
      });
      if (!confirmed) return;
    }

    await api.post(`/api/instances/${instance.id}/action`, { action });
    onReload();
  };

  if (statusLower === 'deploying' || statusLower === 'initializing') return null;

  const storageUsedLabel = formatStorageQuotaLabel(stats.storageUsedBytes);
  const storageLimitLabel = formatStorageQuotaLabel(stats.storageLimitBytes);
  const storageSafeLimitLabel = formatStorageQuotaLabel(
    typeof stats.storageLimitBytes === "number" && Number.isFinite(stats.storageLimitBytes)
      ? Math.floor(stats.storageLimitBytes * 0.95)
      : null
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-4 mt-2">
      {/* 存储超额阻断提示 */}
      {stats.storageStatus === 'exceeded' && (
        <div className="bg-rose-50 dark:bg-rose-950/25 border-2 border-rose-200 dark:border-rose-900/40 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-start gap-4">
            <div className="bg-rose-100 dark:bg-rose-900/50 p-2.5 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200 mb-1">{t("storage_exceeded_title")}</h3>
              <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed font-medium">
                {t("storage_exceeded_usage", { used: storageUsedLabel, limit: storageLimitLabel })}
                <br />
                <strong>{t("storage_exceeded_guide_label")}</strong> {t("storage_exceeded_guide", { safeLimit: storageSafeLimitLabel })}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-white dark:bg-rose-950/25 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 font-bold"
                  onClick={(e) => { e.stopPropagation(); onViewFiles && onViewFiles(); }}
                >
                  <Folder className="w-4 h-4 mr-1.5" />
                  {t("storage_open_cleanup")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 旧实例新版访问链路兼容检测提示 */}
      {(() => {
        const comp = stats.accessBridgeCompatibility || instance.accessBridgeCompatibility;
        if (comp && comp.required === true && comp.compatible === false && comp.actionRequired === "redeploy") {
          return (
            <div className="bg-amber-50 dark:bg-amber-950/25 border-2 border-amber-200 dark:border-amber-900/40 rounded-2xl p-5 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="flex items-start gap-4">
                <div className="bg-amber-100 dark:bg-amber-900/50 p-2.5 rounded-xl">
                  <AlertTriangle className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200 mb-1">
                    {t("old_instance_warning_title")}
                  </h3>
                  <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed font-medium">
                    {t("old_instance_warning_desc")}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white dark:bg-amber-950/25 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-bold"
                      onClick={(e) => handleAction('redeploy', e, true, t('confirm_redeploy_and_fix'))}
                    >
                      <RefreshCw className="w-4 h-4 mr-1.5" />
                      {t("btn_redeploy_and_fix")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* 核心服务链路健康体检 (Collapsible with Core Summary Grid) */}
      {(() => {
        let passed = 0;
        let total = 5; // Port, s6, Proxy, Gateway, Physical

        const isPortOk = statusLower === 'running' || statusLower === 'gateway_ready' || statusLower === 'partial_running' || statusLower === 'dashboard_ready';
        if (isPortOk) passed++;

        const isS6Ok = statusLower === 'running' || statusLower === 'gateway_ready' || statusLower === 'partial_running' || statusLower === 'dashboard_ready';
        if (isS6Ok) passed++;

        const isProxyOk = statusLower === 'running' || statusLower === 'gateway_ready';
        if (isProxyOk) passed++;

        const isGatewayOk = instance.gateway_ready === true;
        if (isGatewayOk) passed++;

        const isPhysicalOk = !instance.physical_error;
        if (isPhysicalOk) passed++;

        if (instance.model_provider) {
          total += 1;
          const isModelConfigOk = instance.model_config_status === 'verified' || instance.model_config_status === 'verified_by_runtime_session' || instance.model_config_status === 'verification_auth_required';
          if (isModelConfigOk) passed++;

          total += 1;
          const isModelRuntimeOk = instance.model_runtime_status === 'callable';
          if (isModelRuntimeOk) passed++;
        }

        return (
          <div className="bg-surface border border-slate-200/40 dark:border-slate-800 rounded-2xl p-4 md:p-5 shadow-sm text-left">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold text-content-secondary flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{t("diagnostics_chain_title")}</span>
              </h4>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-semibold leading-normal border",
                passed === total
                  ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/40"
                  : "bg-amber-50 dark:bg-amber-950/30 text-amber-750 dark:text-amber-300 border-amber-100 dark:border-amber-900/40"
              )}>
                {t("diagnostics_passed_count", { passed, total })}
              </span>
            </div>

            {/* 2x2 Core Run Summary Grid */}
            <div className="grid grid-cols-2 gap-2 mt-3 p-3 bg-surface-muted/50 rounded-xl border border-slate-200/40 dark:border-slate-800">
              {/* 网关状态 */}
              <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  instance.gateway_ready === true ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
                )} />
                <span className="text-content-muted font-medium shrink-0">{t("diagnostics_gateway_label")}</span>
                <span className="font-semibold text-content-secondary truncate">
                  {instance.gateway_ready === true ? t("status_ready") : instance.gateway_status === "starting" ? t("status_checking") : t("status_not_ready")}
                </span>
              </div>

              {/* 模型状态 */}
              <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  !instance.model_provider ? "bg-slate-300" : (instance.model_config_status === 'verified' || instance.model_config_status === 'verified_by_runtime_session') ? "bg-emerald-500" : "bg-amber-400"
                )} />
                <span className="text-content-muted font-medium shrink-0">{t("diagnostics_model_label")}</span>
                <span className="font-semibold text-content-secondary truncate">
                  {!instance.model_provider ? t("status_not_configured") : (instance.model_config_status === 'verified' || instance.model_config_status === 'verified_by_runtime_session') ? t("status_ready") : t("status_pending_verification")}
                </span>
              </div>

              {/* 通信渠道 */}
              <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  instance.configured_channels && instance.configured_channels > 0 ? "bg-purple-500" : "bg-slate-300"
                )} />
                <span className="text-content-muted font-medium shrink-0">{t("diagnostics_channel_label")}</span>
                <span className="font-semibold text-content-secondary truncate">
                  {instance.configured_channels && instance.configured_channels > 0 ? t("diagnostics_channels_connected", { connected: instance.connected_channels || 0, total: instance.configured_channels }) : t("diagnostics_web_console")}
                </span>
              </div>

              {/* 物理状态 */}
              <div className="flex items-center gap-1.5 text-[11px] min-w-0">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  isPhysicalOk ? "bg-emerald-500" : "bg-red-500 animate-pulse"
                )} />
                <span className="text-content-muted font-medium shrink-0">{t("diagnostics_physical_label")}</span>
                <span className="font-semibold text-content-secondary truncate">
                  {isPhysicalOk ? t("status_synced") : t("status_physical_conflict")}
                </span>
              </div>
            </div>

            {/* diagnostics expand button */}
            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-200/40 dark:border-slate-800">
              <span className="text-[11px] font-semibold text-content-muted tracking-wide uppercase">{t("diagnostics_report_title")}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowDiagnostics(!showDiagnostics); }}
                className="flex items-center gap-1 px-2.5 py-1 bg-control-hover hover:bg-slate-200 dark:hover:bg-slate-700 text-content-secondary rounded-lg text-[11px] font-semibold border border-slate-200/40 dark:border-slate-700 transition-all shrink-0 cursor-pointer"
              >
                {showDiagnostics ? (
                  <>
                    <span>{t("diagnostics_collapse_report")}</span>
                    <ChevronUp className="w-3.5 h-3.5 text-content-muted" />
                  </>
                ) : (
                  <>
                    <span>{t("diagnostics_expand_report", { total })}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
                  </>
                )}
              </button>
            </div>

            {showDiagnostics && (
              <div className="space-y-2.5 mt-3 animate-in fade-in slide-in-from-top-1 duration-150">
                {/* Item 1: internal_web_port */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.portTitle")}</span>
                  {(statusLower === 'running' || statusLower === 'gateway_ready' || statusLower === 'partial_running' || statusLower === 'dashboard_ready') ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal">
                      <Check className="w-3 h-3" /> {t("runtimeMetrics.health.portReady")}
                    </span>
                  ) : (statusLower === 'initializing' || statusLower === 'container_starting' || statusLower === 'gateway_starting') ? (
                    <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded animate-pulse leading-normal">
                      {t("runtimeMetrics.health.portChecking")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-content-muted font-bold bg-surface-muted px-2 py-0.5 rounded leading-normal">
                      {t("runtimeMetrics.health.portClosed")}
                    </span>
                  )}
                </div>

                {/* Item 2: 麦贝主进程 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.supervisorTitle")}</span>
                  {(statusLower === 'running' || statusLower === 'gateway_ready' || statusLower === 'partial_running' || statusLower === 'dashboard_ready') ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal">
                      <Check className="w-3 h-3" /> {t("runtimeMetrics.health.supervisorReady")}
                    </span>
                  ) : (statusLower === 'initializing' || statusLower === 'container_starting' || statusLower === 'gateway_starting') ? (
                    <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded animate-pulse leading-normal">
                      {t("runtimeMetrics.health.supervisorLoading")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-content-muted font-bold bg-surface-muted px-2 py-0.5 rounded leading-normal">
                      {t("runtimeMetrics.health.supervisorStopped")}
                    </span>
                  )}
                </div>

                {/* Item 3: 路由代理 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.proxyTitle")}</span>
                  {(statusLower === 'running' || statusLower === 'gateway_ready') ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal">
                      <Check className="w-3 h-3" /> {instance.proxyMode === 'traefik' ? t('access_traefik_ready') : (instance.proxyMode === 'local' || instance.proxyMode === 'lan') ? t('access_local_ready') : t('access_nginx_ready')}
                    </span>
                  ) : (statusLower === 'partial_running' || statusLower === 'dashboard_ready' || statusLower === 'gateway_starting') ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/25 px-2 py-0.5 rounded leading-normal">
                      ⚠️ {instance.proxyMode === 'traefik' ? t('access_traefik_pending') : (instance.proxyMode === 'local' || instance.proxyMode === 'lan') ? t('access_local_pending') : t('access_nginx_pending')}
                    </span>
                  ) : (statusLower === 'initializing' || statusLower === 'container_starting') ? (
                    <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded animate-pulse leading-normal">
                      {t("runtimeMetrics.health.proxySyncing")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-content-muted font-bold bg-surface-muted px-2 py-0.5 rounded leading-normal">
                      {t("runtimeMetrics.health.proxyRemoved")}
                    </span>
                  )}
                </div>

                {/* Item 3.5: Hermes Gateway Prober */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.gatewayTitle")}</span>
                  {instance.gateway_status === 'dashboard_auth_required' ? (
                    <div className="flex flex-col items-end">
                      <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400 font-bold bg-red-50 dark:bg-rose-950/25 px-2 py-0.5 border border-red-200 dark:border-rose-900/40 rounded leading-normal">
                        {t("runtimeMetrics.health.dashboardAuthMissingTitle")}
                      </span>
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium mt-1 max-w-sm text-right leading-relaxed">
                        {t("runtimeMetrics.health.dashboardAuthMissingDescription")}
                      </span>
                    </div>
                  ) : instance.gateway_status === 'hermes_session_cookie_missing_or_bridge_failed' ? (
                    <div className="flex flex-col items-end">
                      <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400 font-bold bg-red-50 dark:bg-rose-950/25 px-2 py-0.5 border border-red-200 dark:border-rose-900/40 rounded leading-normal">
                        {t("runtimeMetrics.health.dashboardSessionMissingTitle")}
                      </span>
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium mt-1 max-w-sm text-right leading-relaxed">
                        {t("runtimeMetrics.health.dashboardSessionMissingDescription")}
                      </span>
                    </div>
                  ) : instance.gateway_status === 'access_control_warning' ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/25 px-2 py-0.5 rounded leading-normal border border-amber-200/50 dark:border-amber-900/40">
                      {String(instance.gateway_error || t("runtimeMetrics.health.unauthorized"))}
                    </span>
                  ) : instance.gateway_ready === true ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal">
                      <Check className="w-3 h-3" /> {String(instance.gateway_error || t("runtimeMetrics.health.gatewayReady"))}
                    </span>
                  ) : instance.gateway_status === 'starting' ? (
                    <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-400 font-bold bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded animate-pulse leading-normal">
                      {t("runtimeMetrics.health.gatewayChecking", { message: String(instance.gateway_error || t("runtimeMetrics.health.gatewayCheckingDefault")) })}
                    </span>
                  ) : (instance.gateway_status === 'unhealthy' || instance.gateway_status === 'error' || instance.gateway_error) ? (
                    <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400 font-bold bg-red-50 dark:bg-rose-950/25 px-2 py-0.5 border border-red-100 dark:border-rose-900/40 rounded leading-normal animate-pulse">
                      {t("runtimeMetrics.health.gatewayFailed", { message: String(instance.gateway_error || t("runtimeMetrics.health.gatewayFailedDefault")) })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-content-muted font-bold bg-surface-muted px-2 py-0.5 rounded leading-normal">
                      {t("runtimeMetrics.health.gatewayWaiting")}
                    </span>
                  )}
                </div>

                {/* Sub-item: Channel status details */}
                {instance.configured_channels !== undefined && instance.configured_channels !== null && instance.configured_channels > 0 ? (
                  <div className="pl-4 pb-2 border-b border-slate-50 dark:border-slate-800/50 flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between text-content-muted">
                      <span>{t("runtimeMetrics.health.channelRate")}</span>
                      <span className="font-bold font-mono text-content-secondary">
                        {t("runtimeMetrics.health.channelsConnected", { connected: instance.connected_channels || 0, total: instance.configured_channels })}
                      </span>
                    </div>
                    {instance.channel_status && Object.keys(instance.channel_status).length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-1 items-center">
                        {Object.entries(instance.channel_status).map(([channelName, chanStatus]) => {
                          const statusStr = typeof chanStatus === 'object' && chanStatus !== null ? (chanStatus as any).status : String(chanStatus);
                          const isChanOk = statusStr === "connected" || statusStr === "ready" || statusStr === "online";
                          const isAwaitingAuth = statusStr === "awaiting_authorization";
                          const isStarting = statusStr === "starting" || statusStr === "connecting";
                          const isConfigMissing = statusStr === "config_missing";
                          const isAuthFailed = statusStr === "auth_failed";

                          let displayText = statusStr;
                          if (statusStr === "connected") displayText = t("runtimeMetrics.health.channelConnected");
                          else if (statusStr === "awaiting_authorization") {
                            if (typeof chanStatus === 'object' && chanStatus !== null && (chanStatus as any).reason) {
                              const reasonStr = (chanStatus as any).reason;
                              displayText = t("runtimeMetrics.health.channelAwaitingAuthorization");
                            } else {
                              displayText = t("runtimeMetrics.health.channelAwaitingAuthorization");
                            }
                          }
                          else if (statusStr === "starting" || statusStr === "connecting") displayText = t("runtimeMetrics.health.channelSyncing");
                          else if (statusStr === "config_missing") displayText = t("runtimeMetrics.health.channelConfigMissing");
                          else if (statusStr === "auth_failed") displayText = t("runtimeMetrics.health.channelCredentialInvalid");
                          else if (statusStr === "unhealthy" || statusStr === "error" || statusStr === "failed") displayText = t("runtimeMetrics.health.channelFailed");

                          if (isAwaitingAuth) {
                            return (
                              <div key={channelName} className="flex items-center gap-1 px-1 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                                <span className="font-sans text-[10px] font-bold text-amber-800 dark:text-amber-400">
                                  {channelName.toUpperCase()}: {displayText}
                                </span>
                                <span className="text-[10px] text-amber-400 dark:text-amber-600">|</span>
                                <button
                                  type="button"
                                  onClick={() => window.dispatchEvent(new CustomEvent("open-auth-panel"))}
                                  className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline hover:no-underline transition-all cursor-pointer"
                                >
                                  {t("runtimeMetrics.health.openAllowlist")}
                                </button>
                              </div>
                            );
                          }

                          return (
                            <span
                              key={channelName}
                              className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-sans text-[10px] font-bold border",
                                isChanOk
                                  ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30"
                                  : isStarting
                                    ? "bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-400 border-blue-100 dark:border-blue-900/30 animate-pulse"
                                    : isConfigMissing
                                      ? "bg-orange-50 dark:bg-orange-950/20 text-orange-800 dark:text-orange-450 border-orange-100 dark:border-orange-900/30"
                                      : isAuthFailed
                                        ? "bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-450 border-rose-100 dark:border-rose-900/30"
                                        : "bg-red-50 dark:bg-rose-950/20 text-red-800 dark:text-rose-450 border-red-100 dark:border-rose-900/30"
                              )}
                            >
                              {channelName.toUpperCase()}: {displayText}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="pl-4 pb-2 border-b border-slate-50 dark:border-slate-800/50 flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between text-content-muted">
                      <span>{t("runtimeMetrics.health.channelRate")}</span>
                      <span className="font-bold text-content-secondary">{t("runtimeMetrics.health.webOnly")}</span>
                    </div>
                  </div>
                )}

                {/* Item 4: 物理一致性 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.reconcilerTitle")}</span>
                  <div className="flex flex-col items-end gap-1">
                    {instance.physical_error ? (
                      <span className="inline-flex items-center gap-1 text-red-700 dark:text-rose-400 bg-red-50 dark:bg-rose-950/25 px-2 py-0.5 rounded leading-normal">
                        <AlertTriangle className="w-3 h-3" /> {t("runtimeMetrics.health.physicalConflict", { status: instance.physical_status })}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal">
                        <Check className="w-3 h-3" /> {t("runtimeMetrics.health.physicalSynced", { status: instance.physical_status || "ok" })}
                      </span>
                    )}
                    {instance.last_reconciled_at && (
                      <span className="text-[9px] text-content-muted font-medium">
                        {t("runtimeMetrics.health.lastReconciled", { time: new Date(instance.last_reconciled_at).toLocaleString(i18n.resolvedLanguage || i18n.language) })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Item 5: standard model configuration & validation status */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs gap-1.5 border-b border-slate-50 dark:border-slate-800/50 pb-2">
                  <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.modelTitle")}</span>
                  <div className="flex flex-col items-end gap-1 text-right">
                    {instance.model_provider ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="text-[11px] font-sans font-medium text-content-secondary bg-surface-muted px-2 py-0.5 border border-outline rounded">
                          {t("runtimeMetrics.health.providerLabel")} <strong className="font-semibold text-slate-800 dark:text-slate-200">{instance.model_provider?.toUpperCase()}</strong> / {t("runtimeMetrics.health.modelLabel")} {instance.model_name || t("status_default")}
                        </div>
                        {instance.model_base_url && (
                          <div className="text-[10px] font-mono text-content-muted truncate max-w-xs">
                            Base URL: {instance.model_base_url}
                          </div>
                        )}
                        {instance.model_config_status === 'verified' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                            <Check className="w-3 h-3" /> {t("runtimeMetrics.health.modelVerified")}
                          </span>
                        )}
                        {instance.model_config_status === 'verified_by_runtime_session' && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                            <Check className="w-3 h-3" /> {t("runtimeMetrics.health.modelVerifiedBySession")}
                          </span>
                        )}
                        {instance.model_config_status === 'verification_auth_required' && (
                          <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                            {t("runtimeMetrics.health.modelAuthRequired")}
                          </span>
                        )}
                        {instance.model_config_status === 'mismatched' && (
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                              {t("runtimeMetrics.health.modelMismatched")}
                            </span>
                            {instance.model_config_error && (
                              <span className="text-[10px] text-content-muted mt-0.5 max-w-xs leading-normal">
                                {instance.model_config_error}
                              </span>
                            )}
                          </div>
                        )}
                        {instance.model_config_status === 'injected' && (
                          <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-450 bg-sky-50 dark:bg-sky-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                            {t("runtimeMetrics.health.modelInjected")}
                          </span>
                        )}
                        {instance.model_config_status === 'written' && (
                          <span className="inline-flex items-center gap-1 text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                            {t("runtimeMetrics.health.modelWritten")}
                          </span>
                        )}
                        {instance.model_config_status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/25 px-2 py-0.5 rounded leading-normal text-[11px] animate-pulse">
                            {t("runtimeMetrics.health.modelPending")}
                          </span>
                        )}
                        {instance.model_config_status === 'failed' && (
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 text-red-700 dark:text-rose-400 bg-red-50 dark:bg-rose-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                              <AlertTriangle className="w-3 h-3" /> {t("runtimeMetrics.health.modelFailed")}
                            </span>
                            {instance.model_config_error && (
                              <span className="text-[9px] text-red-500 dark:text-rose-400 font-sans mt-0.5 max-w-xs leading-normal">
                                {instance.model_config_error}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-content-muted bg-surface-muted px-2 py-0.5 rounded leading-normal text-[11px]">
                        {t("runtimeMetrics.health.modelNotConfigured")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Item 6: model_runtime_status */}
                {instance.model_provider && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs border-b border-slate-50 dark:border-slate-800/50 pb-2 gap-1.5">
                    <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.llmRuntimeTitle")}</span>
                    <div className="flex flex-col items-end gap-1 text-right">
                      {instance.model_runtime_status === 'callable' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded leading-normal text-[11px]">
                          <Check className="w-3 h-3" /> {t("runtimeMetrics.health.llmCallable")}
                        </span>
                      ) : instance.model_runtime_error ? (
                        <div className="flex flex-col items-end">
                          <span className="inline-flex items-center gap-1 text-orange-700 dark:text-orange-450 bg-orange-50 dark:bg-orange-950/25 rounded leading-normal text-[11px]">
                            {t("runtimeMetrics.health.llmBlocked")}
                          </span>
                          <span className="text-[10px] text-content-muted mt-0.5 max-w-xs leading-normal">
                            {instance.model_runtime_error}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-content-muted font-medium bg-surface-muted px-2 py-0.5 rounded leading-normal text-[11px]">
                          {t("runtimeMetrics.health.llmNotTested")}
                        </span>
                      )}
                      {instance.model_runtime_details && (
                        <span className="text-[10px] text-content-muted font-sans mt-0.5 block max-w-md">
                          {instance.model_runtime_details}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Supplemental diagnostic: model_options_status (not included in the 7 critical checks) */}
                {instance.model_provider && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs gap-1.5">
                    <span className="text-content-muted font-medium font-sans">{t("runtimeMetrics.health.optionsTitle")}</span>
                    <div className="flex flex-col items-end gap-1 text-right">
                      {instance.model_options_status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium bg-emerald-950/10 dark:bg-emerald-950/20 px-2 py-0.5 rounded leading-normal text-[11px]">
                          {t("runtimeMetrics.health.optionsSuccess")}
                        </span>
                      ) : instance.model_options_status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-content-muted font-medium bg-surface-muted px-2 py-0.5 rounded leading-normal text-[11px]">
                          {t("runtimeMetrics.health.optionsAuthRequired")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-content-muted font-medium bg-surface-muted px-2 py-0.5 rounded leading-normal text-[11px]">
                          {t("runtimeMetrics.health.optionsChecking")}
                        </span>
                      )}
                      {instance.model_options_error && (
                        <span className="text-[9px] text-content-muted max-w-xs mt-0.5 leading-normal truncate">
                          {instance.model_options_error}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
      {statusLower === 'partial_running' && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-content text-xs text-left">
          {instance.proxyMode === 'traefik' ? (
            <>
              <div className="flex items-start gap-2 mb-2 font-medium text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {t("runtimeMetrics.health.traefikRoutePending")}
                </span>
              </div>

              <div className="relative font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto leading-relaxed whitespace-pre select-all border border-slate-800 my-2 text-[11px] sm:text-xs">
{`Proxy Mode: Traefik
Traefik Route: ${getSubdomain(instance.url)} -> dashboard:9119
Traefik Network: ${instance.traefikNetwork || 'traefik_proxy'}
Web Protection: ${instance.config?.username ? 'Enabled' : 'Disabled'}
Username: ${instance.config?.username || 'None'}`}
{instance.config?.webPasswordHash && '\nPassword: [Hidden]'}
                <div className="mt-3 flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 w-full sm:w-auto"
                    onClick={(e) => { e.stopPropagation(); onOpenSettings && onOpenSettings(); }}
                  >
                    {t("runtimeMetrics.health.resetAccessPassword")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 mb-2 font-medium text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {t("runtimeMetrics.health.nginxRoutePending")}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 访问配置模块 - Easy Read Info Panel */}
      {(statusLower === 'running' || statusLower === 'partial_running' || statusLower === 'gateway_ready' || statusLower === 'dashboard_ready' || statusLower === 'gateway_starting' || statusLower === 'container_starting' || statusLower === 'unhealthy') && (
        <div className="bg-surface border border-slate-200/40 dark:border-slate-800 shadow-sm rounded-2xl p-4 md:p-5 text-left" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-content-secondary font-medium">
              <div className="flex items-center gap-1">
                <span className="text-content-muted font-semibold shrink-0">{t("diagnostics_gateway_label")}</span>
                <span className="font-semibold text-content-secondary truncate">{instance.proxyMode === 'traefik' ? 'Traefik' : (instance.proxyMode === 'local' || instance.proxyMode === 'lan') ? t('access_local_direct') : 'Nginx'}</span>
              </div>
              <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 shrink-0" />
              <div className="flex items-center gap-1">
                <span className="text-content-muted font-semibold shrink-0">{t("access_security_label")}</span>
                <span className="font-semibold text-content-secondary truncate">
                  {instance.configSummary === undefined || instance.configSummary === null ? (
                    <span className="text-content-muted">{t("status_checking_ellipsis")}</span>
                  ) : instance.configSummary.authMode === "disabled" ? (
                    <span className="text-content-muted">{instance.configSummary.accessProtectionLabel || t("dashboard_access_disabled_title")}</span>
                  ) : (instance.configSummary.hasPassword || instance.configSummary.authMode === "basic_auth") ? (
                    <span className="text-brand-600 flex items-center gap-1">
                      {t("status_enabled")} <span className="font-normal font-mono text-[11px] text-content-muted">({instance.configSummary.accessProtectionLabel || t("access_password_protected")})</span>
                    </span>
                  ) : (instance.configSummary.hasPassword === false && instance.configSummary.authMode === "public") ? (
                    <span className="text-content-muted">{t("access_public_no_password")}</span>
                  ) : (
                    <span className="text-content-muted">{t("status_unknown")}</span>
                  )}
                </span>
              </div>
              {(instance.configSummary?.configuredChannels && instance.configSummary.configuredChannels.length > 0) && (
                <>
                  <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 shrink-0" />
                  <div className="flex items-center gap-1">
                    <span className="text-content-muted font-semibold shrink-0">{t("diagnostics_channel_label")}</span>
                    <span className="font-semibold text-purple-750 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100 text-[11px] dark:bg-purple-500/20 dark:text-purple-100 dark:border-purple-400/30">{(instance.configSummary.channelLabel || instance.configSummary.channel || t("status_unknown")).toUpperCase()}</span>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowAccessDetails(!showAccessDetails); }}
              className="flex items-center gap-1 px-2.5 py-1 bg-surface hover:bg-control-hover text-content-secondary rounded-lg text-[11px] font-semibold border border-outline transition-all shrink-0 cursor-pointer"
            >
              <span>{showAccessDetails ? t("access_collapse_details") : t("access_config_details")}</span>
              {showAccessDetails ? <ChevronUp className="w-3 h-3 text-content-muted" /> : <ChevronDown className="w-3 h-3 text-content-muted" />}
            </button>
          </div>

          {showAccessDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px] mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-800 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center sm:flex-col sm:items-start gap-2 sm:gap-1 bg-surface-muted/65 sm:bg-transparent sm:dark:bg-transparent p-2.5 sm:p-0 rounded-xl border border-outline sm:border-transparent sm:dark:border-transparent min-w-0">
                <span className="text-content-muted font-semibold shrink-0 text-[11px]">{t("access_proxy_gateway")}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 ml-auto sm:ml-0 text-[12px] truncate">{instance.proxyMode === 'traefik' ? t('access_traefik_network') : (instance.proxyMode === 'local' || instance.proxyMode === 'lan') ? t('access_local_direct') : t('access_nginx_network')}</span>
              </div>
              <div className="flex items-center sm:flex-col sm:items-start gap-2 sm:gap-1 bg-surface-muted/65 sm:bg-transparent sm:dark:bg-transparent p-2.5 sm:p-0 rounded-xl border border-outline sm:border-transparent sm:dark:border-transparent min-w-0">
                <span className="text-content-muted font-semibold shrink-0 text-[11px]">{t("access_protection_label")}</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 ml-auto sm:ml-0 text-[12px] truncate">
                  {instance.configSummary === undefined || instance.configSummary === null ? (
                    <span className="text-content-muted">{t("status_checking_ellipsis")}</span>
                  ) : instance.configSummary.authMode === "disabled" ? (
                    <span className="text-content-muted">{instance.configSummary.accessProtectionLabel || t("dashboard_access_disabled_title")}</span>
                  ) : (instance.configSummary.hasPassword || instance.configSummary.authMode === "basic_auth") ? (
                    <span className="text-brand-600 flex items-center gap-1">
                      {t("status_enabled")} <span className="font-normal font-mono text-[11px] text-content-muted">({instance.configSummary.accessProtectionLabel || t("access_password_protected")})</span>
                    </span>
                  ) : (instance.configSummary.hasPassword === false && instance.configSummary.authMode === "public") ? (
                    <span className="text-content-muted">{t("access_public_no_password")}</span>
                  ) : (
                    <span className="text-content-muted">{t("status_unknown")}</span>
                  )}
                </span>
              </div>
              {(instance.configSummary?.configuredChannels && instance.configSummary.configuredChannels.length > 0) && (
                <div className="flex items-center sm:flex-col sm:items-start gap-2 sm:gap-1 bg-surface-muted/65 sm:bg-transparent sm:dark:bg-transparent p-2.5 sm:p-0 rounded-xl border border-outline sm:border-transparent sm:dark:border-transparent min-w-0">
                  <span className="text-content-muted font-semibold shrink-0 text-[11px]">{t("access_channel_activation")}</span>
                  <div className="flex items-center gap-1.5 ml-auto sm:ml-0 flex-wrap justify-end sm:justify-start">
                    <span className="font-semibold text-purple-750 bg-purple-50 px-2 py-0.5 rounded border border-purple-100 text-[11px] dark:bg-purple-500/20 dark:text-purple-100 dark:border-purple-400/30">{(instance.configSummary.channelLabel || instance.configSummary.channel || t("status_unknown")).toUpperCase()}</span>
                    {onViewGuide && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewGuide(instance.configSummary?.channel || 'default'); }}
                        className="text-blue-650 hover:text-blue-700 hover:underline text-[11px] font-semibold shrink-0"
                      >{t("access_guide")}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-outline">
            <Button
               variant="outline"
               className="min-h-[40px] px-3 text-[12px] font-semibold text-brand-600 border-brand-200 bg-brand-50/20 hover:bg-brand-50/50 transition-all rounded-xl active:scale-95 flex items-center justify-center gap-1.5 dark:bg-indigo-950/40 dark:border-indigo-700/60 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
               onClick={async (e) => {
                 e.stopPropagation();
                 try {
                   const data = await api.post(`/api/instances/${instance.id}/test-auth`);
                   if (data) {
                     const isProtected = data.statusCode === 401;
                     showAlert({
                       title: t("access_test_done_title"),
                       message: t("access_test_status_code", { code: data.statusCode }),
                       type: isProtected ? "success" : "warning",
                       details: isProtected
                         ? t("access_test_protected_details")
                         : t("access_test_public_details")
                     });
                   }
                 } catch(err: any) {
                   showAlert({
                     title: t("access_test_failed_title"),
                     message: t("access_test_failed_message"),
                     type: "error",
                     details: err?.message || ""
                   });
                 }
               }}
            >{t("access_test_button")}</Button>
            <Button
              variant="outline"
              className="min-h-[40px] px-3 text-[12px] font-semibold text-slate-600 border-slate-200 hover:bg-slate-100 transition-all rounded-xl active:scale-95 flex items-center justify-center gap-1.5 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={(e) => { e.stopPropagation(); onOpenSettings && onOpenSettings(); }}
            >
              {instance.configSummary?.hasPassword ? t('access_reset_password') : t('access_enable_console_protection')}
            </Button>
            <Button
              variant="outline"
              className="col-span-2 md:col-span-1 min-h-[40px] px-3 text-[12px] font-semibold text-slate-700 border-slate-200 bg-slate-50/50 hover:bg-slate-100 transition-all rounded-xl active:scale-95 flex items-center justify-center gap-1.5 dark:bg-slate-900/60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={(e) => { e.stopPropagation(); onViewFiles && onViewFiles(); }}
            >
              <Folder className="w-4 h-4 text-purple-500 dark:text-purple-400" />{t("access_browse_instance_files")}</Button>
          </div>
        </div>
      )}

        <RuntimeMetricsPanel
          instance={instance}
          statusLower={statusLower}
          stats={stats}
          showMetricsDetails={showMetricsDetails}
          setShowMetricsDetails={setShowMetricsDetails}
        />

       {/* 折叠检测面板 - Environment Check Accordion */}
        {(!isMobile || showDiagnostics) && (
       <div className="border border-slate-200/40 dark:border-slate-800 rounded-2xl overflow-hidden bg-surface shadow-sm mt-1" onClick={e => e.stopPropagation()}>
         <button
            onClick={(e) => { e.stopPropagation(); setShowConfigSummary(!showConfigSummary); }}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-muted/10 hover:bg-surface-muted/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="text-[12px] font-semibold text-content-secondary">{t("env_check_title")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-content-muted">
              <span className="text-[11px] font-semibold bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded border border-slate-200/40 dark:border-emerald-900/40">{t("runtimeMetrics.health.pass")}</span>
              {showConfigSummary ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

         {showConfigSummary && (
           <div className="px-4 pb-4 pt-1 bg-surface border-t border-outline space-y-4 text-xs">
             <div className="p-3 bg-slate-900 rounded-xl text-slate-200 font-mono text-[11px] space-y-2 overflow-x-auto select-all leading-relaxed">
               <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2 text-[10px] text-content-muted font-sans font-bold">
                 <span>{t("runtimeMetrics.health.configChecks")}</span>
                 <span className="text-green-400 block font-normal px-1.5 py-0.5 bg-green-950/40 border border-green-900/40 rounded">{t("runtimeMetrics.health.pass")}</span>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                 <div className="min-w-0">
                   <span className="text-content-muted block mb-0.5">{t("runtimeMetrics.health.providerField")}</span>
                   <span className="text-white block font-semibold truncate break-all">
                     {instance.configSummary?.configChecks?.provider?.value || t("status_checking_ellipsis")}
                   </span>
                   <span className="text-[10px] mt-1 block">
                     {instance.configSummary?.configChecks?.provider?.isValid
                       ? <span className="text-green-400 font-sans font-bold">{t("runtimeMetrics.health.validString")}</span>
                       : <span className="text-red-400 font-sans font-bold">{t("runtimeMetrics.health.invalidString")}</span>
                     }
                   </span>
                 </div>

                 <div className="min-w-0">
                   <span className="text-content-muted block mb-0.5">{t("runtimeMetrics.health.modelField")}</span>
                   <span className="text-white block font-semibold truncate break-all">
                     {instance.configSummary?.configChecks?.model?.value || t("status_checking_ellipsis")}
                   </span>
                   <span className="text-[10px] mt-1 block">
                     {instance.configSummary?.configChecks?.model?.isValid
                       ? <span className="text-green-400 font-sans font-bold">{t("runtimeMetrics.health.validString")}</span>
                       : <span className="text-red-400 font-sans font-bold">{t("runtimeMetrics.health.invalidString")}</span>
                     }
                   </span>
                 </div>

                 <div className="min-w-0">
                   <span className="text-content-muted block mb-0.5">{t("runtimeMetrics.health.baseUrlField")}</span>
                   <span className="text-white block font-semibold truncate break-all">
                      {instance.configSummary?.configChecks?.baseUrl?.value || t("env_use_default_channel")}
                   </span>
                   <span className="text-[10px] mt-1 block">
                     {instance.configSummary?.configChecks?.baseUrl?.status === "pass" || instance.configSummary?.configChecks?.baseUrl?.isValid
                       ? <span className="text-green-400 font-sans font-bold">{t("runtimeMetrics.health.validString")}</span>
                       : <span className="text-red-400 font-sans font-bold">{t("runtimeMetrics.health.invalidString")}</span>
                     }
                   </span>
                 </div>

                 <div className="min-w-0">
                   <span className="text-content-muted block mb-0.5">{t("runtimeMetrics.health.providerApiKeyField")}</span>
                   <span className="text-white block font-semibold font-sans tracking-widest text-[10px] truncate break-all">
                     {instance.configSummary?.configChecks?.providerApiKey?.configured ? t("env_key_configured") : t("env_key_not_set")}
                   </span>
                   <span className="text-[10px] mt-1 block font-sans font-bold">
                     {instance.configSummary?.configChecks?.providerApiKey?.configured
                       ? <span className="text-green-400">{t("runtimeMetrics.health.keyConfigured")}</span>
                       : <span className="text-amber-400">{t("runtimeMetrics.health.keyMissing")}</span>
                     }
                   </span>
                 </div>
               </div>
             </div>
           </div>
         )}
       </div>

       )}

        {/* Dynamic Channel Binding Audits & One-Click Whitelists */}
        {(!isMobile || showDiagnostics) && (
       <ChannelPendingAuthPanel instance={instance} currentUser={currentUser} />
        )}

       {/* Actions Bar - Desktop Only */}
        <div className="hidden md:flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 mt-4 pt-4 border-t border-outline" onClick={e => e.stopPropagation()}>
           <div className="flex gap-2">
              {statusLower === 'stopped' ? (
                 <Button
                   variant="outline"
                   className="h-9 px-4 text-xs font-semibold text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 transition-colors"
                   onClick={(e) => handleAction('start', e)}
                 >{t("btn_start")}</Button>
              ) : (
                 <Button
                   variant="outline"
                   className="h-9 px-4 text-xs font-medium text-content-secondary border-outline hover:bg-control-hover transition-colors"
                   onClick={(e) => handleAction('restart', e, true, t('confirm_restart_instance'))}
                 >{t("btn_restart")}</Button>
              )}

              <Button
                className="h-9 px-4 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
                title={t('tooltip_redeploy')}
                onClick={(e) => handleAction('redeploy', e, true, t('confirm_redeploy'))}
              >
                {t('btn_redeploy')}
              </Button>
           </div>

           {/* Danger / Advanced Actions */}
           <div className="flex gap-2">
              {showMoreMaintenance && (
                <div className="flex gap-1.5 animate-in fade-in slide-in-from-right-1 duration-150">
                  {statusLower !== 'stopped' && (
                     <Button
                       variant="outline"
                       className="h-9 px-3 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                       onClick={(e) => handleAction('stop', e, true, t('confirm_stop_instance'))}
                     >{t("btn_stop")}</Button>
                  )}
                  {instance.status === 'partial_running' && (
                     <Button
                       variant="outline"
                       className="h-9 px-3 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-350 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40 flex items-center gap-1.5"
                       onClick={handleRecheckHealth}
                       disabled={rechecking}
                     >
                       <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />{t("btn_recheck_proxy")}</Button>
                  )}
                  <Button
                    variant="outline"
                    className="h-9 px-3 text-xs font-medium text-content-secondary border-outline hover:bg-control-hover"
                    title={t('tooltip_refresh_gateway')}
                    onClick={(e) => handleAction('rebuild_proxy', e, true, instance.proxyMode === 'traefik' ? t('confirm_refresh_gateway_traefik') : t('confirm_refresh_gateway_nginx'))}
                  >
                    {t('btn_refresh_gateway')}
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                className="h-9 px-3 text-xs font-semibold text-content-muted hover:text-slate-700 dark:hover:text-slate-200 border border-outline hover:bg-control-hover flex items-center gap-1"
                onClick={(e) => { e.stopPropagation(); setShowMoreMaintenance(!showMoreMaintenance); }}
              >
                <span>{showMoreMaintenance ? t("maintenance_hide_more") : t("maintenance_more")}</span>
                {showMoreMaintenance ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
           </div>
        </div>
     </div>
   );
 }
