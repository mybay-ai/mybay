import React from "react";
import { createPortal } from "react-dom";
import {
  X,
  Terminal,
  Folder,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Globe,
  HardDrive,
  ArrowUpRight,
  MessageSquare,
  Copy,
  Check,
  Lock,
  Unlock,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  ShieldCheck,
  Eye,
  EyeOff
} from "lucide-react";
import { Socket } from "socket.io-client";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AgentInstance, User as UserType } from "../../types";
import { Button, cn } from "../ui";
import { LogViewer } from "../LogViewer";
import { InstanceFilesSection } from "../InstanceFilesSection";
import { InstanceRuntimeContextViewer } from "./InstanceRuntimeContextViewer";
import { InstanceDiagnosticsWorkspace } from "./InstanceDiagnosticsWorkspace";
import { api } from "../../lib/api";
import { useFeedback } from "../FeedbackProvider";
import { getRefinedStatusLabel } from "./instanceStatus";
import { APP_ROUTES } from "../../constants/routes";

interface InstanceDetailPanelProps {
  activeLogs: string | null;
  instances: AgentInstance[];
  setActiveLogs: (id: string | null) => void;
  detailTab: 'logs' | 'files' | 'context' | 'diagnostics';
  setDetailTab: (tab: 'logs' | 'files' | 'context' | 'diagnostics') => void;
  currentUser: UserType;
  socket: Socket | null;
  terminalDetailsRef: React.RefObject<HTMLDivElement | null>;
  setEditingInstance: (instance: AgentInstance | null) => void;
  handleInstanceAction: (id: string, action: string, requireConfirm?: boolean, confirmMsg?: string) => void;
}

export function InstanceDetailPanel({
  activeLogs,
  instances,
  setActiveLogs,
  detailTab,
  setDetailTab,
  currentUser,
  socket,
  terminalDetailsRef,
  setEditingInstance,
  handleInstanceAction
}: InstanceDetailPanelProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { showToast, showAlert } = useFeedback();
  const [copiedIdState, setCopiedIdState] = React.useState(false);
  const [activeLogTab, setActiveLogTab] = React.useState<'deployment' | 'runtime' | 'audit'>('deployment');

  const [healthData, setHealthData] = React.useState<any>(null);
  const [healthLoading, setHealthLoading] = React.useState(false);
  const [credentials, setCredentials] = React.useState<any>(null);
  const [credentialsLoading, setCredentialsLoading] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [showNewPassword, setShowNewPassword] = React.useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = React.useState(false);
  const [copiedField, setCopiedField] = React.useState<string | null>(null);
  const [confirmedFirstLogin, setConfirmedFirstLogin] = React.useState(true);
  const [showPasswordSection, setShowPasswordSection] = React.useState(false);

  const selectedInstance = instances.find(i => i.id === activeLogs);

  // Fetch health data & check for one-time credentials
  React.useEffect(() => {
    if (!activeLogs) return;

    setHealthData(null);
    setCredentials(null);
    setShowPasswordSection(false);

    // Read credentials from sessionStorage for this instance if present
    const storedOneTimeCreds = sessionStorage.getItem("one_time_credentials_instance_" + activeLogs);
    if (storedOneTimeCreds) {
      try {
        const parsed = JSON.parse(storedOneTimeCreds);
        setCredentials(parsed);
        setConfirmedFirstLogin(false);
      } catch (e) {
        console.error("Failed to parse one-time credentials:", e);
        setConfirmedFirstLogin(true);
      }
    } else {
      setConfirmedFirstLogin(true);
    }

    const fetchHealth = async () => {
      try {
        const res = await api.get(`/api/instances/${activeLogs}/healthz`);
        setHealthData(res);
      } catch (e) {
        console.error("Failed to fetch instance health:", e);
      }
    };

    fetchHealth();

    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, [activeLogs]);

  const handleCopyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleResetPassword = async () => {
    if (!newPassword.trim()) {
      showToast(t("instance_detail_password_required"), "error");
      return;
    }
    setResetPasswordLoading(true);
    try {
      const res = await api.post(`/api/instances/${activeLogs}/reset-password`, { password: newPassword });

      const newCreds = {
        username: res.username || "admin",
        password: res.password,
        url: selectedInstance?.url || res.url
      };

      setCredentials(newCreds);
      sessionStorage.setItem("one_time_credentials_instance_" + activeLogs, JSON.stringify(newCreds));
      setNewPassword("");
      setConfirmedFirstLogin(false);
      showToast(t("instance_detail_password_reset_success"), "success");
      try { sessionStorage.removeItem(`instance_diagnostics_pending_${activeLogs}`); } catch {}
      window.dispatchEvent(new CustomEvent("mybay:diagnostics-recheck", { detail: { instanceId: activeLogs, checkCode: "DASHBOARD_AUTH" } }));
    } catch (e: any) {
      console.error("Failed to reset password:", e);
      showToast(e.message || t("instance_detail_password_reset_failed"), "error");
    } finally {
      setResetPasswordLoading(false);
    }
  };

  // Prevent background scrolling while detail workspace is open
  React.useEffect(() => {
    if (activeLogs) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeLogs]);

  // Support ESC keyboard shortcut to dismiss
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeLogs) {
        setActiveLogs(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeLogs, setActiveLogs]);

  if (!activeLogs || !selectedInstance) return null;

  const refinedStatusLabel = getRefinedStatusLabel(selectedInstance);

  const getCpuDisplay = (instance: any) => {
    const cpu = instance?.configSummary?.limitsCpu || instance?.limitsCpu || instance?.limits_cpu;
    if (cpu === undefined || cpu === null || cpu === '') {
      return "0.5";
    }
    const str = String(cpu).trim().toLowerCase();
    if (str === "unlimited" || str === "none" || str === "0") {
      return t("instance_detail_unlimited");
    }
    return cpu;
  };

  const getMemDisplay = (instance: any) => {
    const mem = instance?.configSummary?.limitsMem || instance?.limitsMemory || instance?.limits_memory || instance?.limitsMemoryMb || instance?.limits_memory_mb;
    if (mem === undefined || mem === null || mem === '') {
      return "512MB";
    }
    const str = String(mem).trim().toLowerCase();
    if (str === "unlimited" || str === "none" || str === "0") {
      return t("instance_detail_unlimited");
    }
    if (/^\d+$/.test(str)) {
      return `${str}MB`;
    }
    return mem;
  };

  // Find previous/next instance index for fast switcher
  const currentIndex = instances.findIndex(i => i.id === activeLogs);
  const prevInstance = currentIndex > 0 ? instances[currentIndex - 1] : null;
  const nextInstance = currentIndex < instances.length - 1 ? instances[currentIndex + 1] : null;

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedIdState(true);
    setTimeout(() => setCopiedIdState(false), 2000);
  };

  const getStatusDotClass = (status: string) => {
    if (refinedStatusLabel.color.includes("animate-pulse")) {
      return "bg-amber-500 ring-amber-500/20 animate-pulse";
    }
    switch (status) {
      case "running":
      case "gateway_ready":
        return "bg-emerald-500 ring-emerald-500/20";
      case "deploying":
      case "initializing":
      case "restarting":
      case "container_starting":
      case "gateway_starting":
      case "gateway_syncing":
      case "dashboard_ready":
        return "bg-amber-500 ring-amber-500/20 animate-pulse";
      case "stopped":
        return "bg-slate-400 ring-slate-400/20";
      default:
        return "bg-rose-500 ring-rose-500/20";
    }
  };

  const panelContent = (
    <div
      ref={terminalDetailsRef}
      className="absolute inset-0 bg-slate-900/25 md:backdrop-blur-xs z-50 flex items-center justify-center p-0 md:p-6 transition-all duration-300 overflow-hidden"
      onClick={() => setActiveLogs(null)}
    >
      <div
        className="relative bg-surface text-content w-full h-[100dvh] md:h-[90vh] md:max-h-[92vh] md:max-w-[1220px] md:rounded-2xl shadow-xl flex flex-col border-0 md:border md:border-slate-200/80 dark:border-slate-800/80 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed Header */}
        <div className="bg-surface-muted/80 border-b border-slate-200/80 dark:border-slate-800 px-4 md:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div className="flex flex-col md:flex-row md:items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className={cn("w-2 h-2 rounded-full ring-4 shrink-0", getStatusDotClass(selectedInstance.status))} />
              <h2 className="font-semibold text-content text-base md:text-lg truncate max-w-[220px] md:max-w-[340px]" title={selectedInstance.name}>
                {selectedInstance.name}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Short ID Badges */}
              <button
                onClick={(e) => handleCopyId(selectedInstance.id, e)}
                className="font-mono text-[11px] text-content-muted bg-surface border border-outline px-2 py-0.5 rounded-md flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                title={t("instance_detail_copy_id")}
              >
                <span>ID: {selectedInstance.id.slice(0, 8)}...</span>
                {copiedIdState ? <Check className="w-2.5 h-2.5 text-green-500" /> : <Copy className="w-2.5 h-2.5 text-content-muted" />}
              </button>

              {/* Status Badge */}
              <span className={cn("inline-flex items-center text-[11px] border px-2 py-0.5 rounded-md font-medium", refinedStatusLabel.textClass)}>
                {refinedStatusLabel.i18nKey ? t(refinedStatusLabel.i18nKey) : refinedStatusLabel.text}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 shrink-0">
            {/* Close Button */}
            <Button
              variant="ghost"
              onClick={() => setActiveLogs(null)}
              className="h-8 w-8 p-0 text-content-muted hover:text-slate-700 dark:hover:text-slate-300 hover:bg-control-hover rounded-lg shrink-0"
              title={t("instance_detail_close")}
            >
              <X className="w-4.5 h-4.5" />
            </Button>
          </div>
        </div>

        {/* Operational Overview Statistics Row */}
        <div className="bg-surface-muted/50 border-b border-slate-200/80 dark:border-slate-800 px-4 md:px-6 py-3.5 grid grid-cols-2 lg:grid-cols-4 gap-3.5 shrink-0 max-h-[160px] overflow-y-auto sm:overflow-visible">
          {/* Card 1: Runtime status */}
          <div className="bg-surface border border-outline/80 p-2.5 rounded-xl flex items-start gap-2.5 shadow-2xs">
            <div className="p-1.5 bg-surface-muted rounded-lg text-indigo-600 dark:text-indigo-400 border border-outline shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-content-muted font-semibold tracking-wider uppercase">{t("instance_detail_runtime_version")}</p>
              <p className="text-[13px] font-bold text-content mt-0.5 truncate">{t("instance_detail_local_docker")}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-300 font-mono mt-0.5 truncate">
                {selectedInstance.resolved_version || selectedInstance.agent_version || t("instance_detail_latest_version")}
              </p>
            </div>
          </div>

          {/* Card 2: AI Foundation Model */}
          <div className="bg-surface border border-outline/80 p-2.5 rounded-xl flex items-start gap-2.5 shadow-2xs">
            <div className="p-1.5 bg-surface-muted rounded-lg text-emerald-600 dark:text-emerald-400 border border-outline shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-content-muted font-semibold tracking-wider uppercase">{t("instance_detail_model_foundation")}</p>
              <p className="text-[13px] font-bold text-content mt-0.5 truncate">
                {selectedInstance.model_provider || selectedInstance.configSummary?.provider || t("instance_detail_not_configured")}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-300 font-mono mt-0.5 truncate">
                {selectedInstance.model_name || selectedInstance.configSummary?.model || t("instance_detail_default_model")}
              </p>
            </div>
          </div>

          {/* Card 3: Interactive Channels */}
          <div className="bg-surface border border-outline/80 p-2.5 rounded-xl flex items-start gap-2.5 shadow-2xs">
            <div className="p-1.5 bg-surface-muted rounded-lg text-blue-600 dark:text-blue-400 border border-outline shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-content-muted font-semibold tracking-wider uppercase">{t("instance_detail_channel_security")}</p>
              <p className="text-[13px] font-bold text-content mt-0.5 truncate">
                {selectedInstance.configSummary?.channelLabel || selectedInstance.configSummary?.channel || t("instance_detail_no_active_channel")}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-300 font-mono mt-0.5 truncate">
                {selectedInstance.configSummary?.configuredChannels && selectedInstance.configSummary.configuredChannels.length > 0
                  ? t("instance_detail_configured_channels", { count: selectedInstance.configSummary.configuredChannels.length })
                  : t("instance_detail_web_delivery")}
              </p>
            </div>
          </div>

          {/* Card 4: Specification limits */}
          <div className="bg-surface border border-outline/80 p-2.5 rounded-xl flex items-start gap-2.5 shadow-2xs">
            <div className="p-1.5 bg-surface-muted rounded-lg text-amber-600 dark:text-amber-400 border border-outline shrink-0">
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-content-muted font-semibold tracking-wider uppercase">{t("instance_detail_container_limits")}</p>
              <p className="text-[13px] font-bold text-content mt-0.5 truncate">
                {t("instance_detail_cpu_memory", { cpu: getCpuDisplay(selectedInstance), memory: getMemDisplay(selectedInstance) })}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-300 font-mono mt-0.5 truncate">
                {t("instance_detail_local_storage", { storage: selectedInstance.limitsDisk || t("instance_detail_unlimited") })}
              </p>
            </div>
          </div>
        </div>

        {/* Pre-access Readiness Check & First-time Login Banner Section */}
        {(() => {
          const channel = selectedInstance.configSummary?.channel || "web";
          const isWeb = channel === "web" || channel === "none";

          const dashboardAccessEnabled = (
            healthData?.dashboard?.enabled
            ?? selectedInstance.configSummary?.enableDashboard
            ?? true
          ) !== false;

          if (!dashboardAccessEnabled) {
            return (
              <div className="border-b border-outline px-4 md:px-6 py-3.5 bg-surface-muted/50 shrink-0 text-left">
                <div className="flex items-start gap-2.5 rounded-xl border border-outline bg-surface p-3.5 shadow-2xs">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-[13px] font-bold text-content">{t("dashboard_access_disabled_title")}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-content-muted">
                      {t("dashboard_access_disabled_desc")}
                    </p>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div className="border-b border-outline px-4 md:px-6 py-3.5 bg-surface-muted/50 shrink-0 flex flex-col gap-3.5 text-left max-h-[300px] overflow-y-auto">

              {/* 1. 首次登录提示卡片 */}
              {isWeb && !confirmedFirstLogin && (
                <div className="bg-indigo-50/70 border-indigo-200 dark:bg-indigo-950/30 dark:border-indigo-900/50 p-4 rounded-xl border flex flex-col gap-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-semibold text-[13px] md:text-sm">
                      <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      <span>{t("instance_detail_first_login_credentials")}</span>
                    </div>
                    <button
                      onClick={() => {
                        sessionStorage.removeItem("one_time_credentials_instance_" + selectedInstance.id);
                        setConfirmedFirstLogin(true);
                      }}
                      className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200 text-[11px] font-bold bg-indigo-100 dark:bg-indigo-950 px-2 py-1 rounded-md transition-colors"
                    >
                      {t("instance_detail_credentials_saved")}
                    </button>
                  </div>

                  <p className="text-[13px] text-indigo-800/80 dark:text-indigo-300/80 leading-relaxed">
                    {t("instance_detail_first_login_description")}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {/* URL */}
                    <div className="bg-surface border border-indigo-100 dark:border-indigo-950/50 rounded-lg p-2 flex flex-col justify-between min-w-0">
                      <span className="text-[9px] font-bold text-content-muted uppercase tracking-wider">{t("instance_detail_access_url")}</span>
                      <div className="flex items-center justify-between gap-1.5 mt-1 min-w-0">
                        <span className="text-[13px] font-semibold font-mono text-slate-700 dark:text-indigo-300 truncate">{selectedInstance.url}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleCopyText(selectedInstance.url || "", "url")}
                            className="p-1 hover:bg-control-hover rounded-md text-content-muted hover:text-content-secondary transition-colors"
                            title={t("instance_detail_copy_url")}
                          >
                            {copiedField === "url" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          {selectedInstance.url && (
                            <a
                              href={selectedInstance.url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 hover:bg-control-hover rounded-md text-content-muted hover:text-indigo-500 transition-colors"
                              title={t("instance_detail_open_url")}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Username */}
                    <div className="bg-surface border border-indigo-100 dark:border-indigo-950/50 rounded-lg p-2 flex flex-col justify-between">
                      <span className="text-[9px] font-bold text-content-muted uppercase tracking-wider">{t("instance_detail_login_username")}</span>
                      <div className="flex items-center justify-between gap-1.5 mt-1">
                        <span className="text-[13px] font-semibold font-mono text-slate-700 dark:text-indigo-300">admin</span>
                        <button
                          onClick={() => handleCopyText("admin", "username")}
                          className="p-1 hover:bg-control-hover rounded-md text-content-muted hover:text-content-secondary transition-colors shrink-0"
                          title={t("instance_detail_copy_username")}
                        >
                          {copiedField === "username" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Password */}
                    <div className="bg-surface border border-indigo-100 dark:border-indigo-950/50 rounded-lg p-2 flex flex-col justify-between">
                      <span className="text-[9px] font-bold text-content-muted uppercase tracking-wider">{t("instance_detail_initial_password")}</span>
                      <div className="flex items-center justify-between gap-1.5 mt-1">
                        <span className="text-[13px] font-bold font-mono text-indigo-600 dark:text-indigo-400 select-all truncate">
                          {credentials?.password || t("instance_detail_generating")}
                        </span>
                        <button
                          onClick={() => handleCopyText(credentials?.password || "", "password")}
                          disabled={!credentials?.password}
                          className="p-1 hover:bg-control-hover rounded-md text-content-muted hover:text-content-secondary transition-colors shrink-0 disabled:opacity-40"
                          title={t("instance_detail_copy_password")}
                        >
                          {copiedField === "password" ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. 访问面板前检查面板 */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface border border-outline p-3.5 rounded-xl shadow-2xs">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-500 shrink-0" />
                    {t("instance_detail_readiness_title")}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5 text-[13px]">
                    {/* Check 1: Container running */}
                    <div className="flex items-center gap-1.5">
                      {healthData?.dashboard?.online ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                      )}
                      <span className={healthData?.dashboard?.online ? "text-content-secondary font-medium" : "text-content-muted"}>
                        {t("instance_detail_instance_status", { status: t(healthData?.dashboard?.online ? "instance_detail_running" : "instance_detail_not_running") })}
                      </span>
                    </div>

                    {/* Check 2: Gateway Router Ready */}
                    <div className="flex items-center gap-1.5">
                      {healthData?.gateway_ready ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-spin" />
                      )}
                      <span className={healthData?.gateway_ready ? "text-content-secondary font-medium" : "text-content-muted"}>
                        {t("instance_detail_gateway_status", { status: t(healthData?.gateway_ready ? "instance_detail_ready" : "instance_detail_syncing") })}
                      </span>
                    </div>

                    {/* Check 3: Dashboard Credentials configured */}
                    <div className="flex items-center gap-1.5">
                      {healthData?.dashboard?.isAuthConfigured ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      )}
                      <span className={healthData?.dashboard?.isAuthConfigured ? "text-content-secondary font-medium" : "text-rose-500 dark:text-rose-400 font-semibold"}>
                        {t("instance_detail_password_status", { status: t(healthData?.dashboard?.isAuthConfigured ? "instance_detail_configured" : "instance_detail_reset_required") })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setShowPasswordSection(!showPasswordSection)}
                    className={cn(
                      "inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border text-[13px] font-semibold shadow-2xs transition-all duration-150",
                      showPasswordSection
                        ? "bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-850 dark:border-slate-700 dark:text-slate-100"
                        : "bg-white border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-800 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    )}
                  >
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span>{t(showPasswordSection ? "instance_detail_hide_security" : "instance_detail_change_password")}</span>
                  </button>
                </div>
              </div>

              {/* 3. 安全配置密码修改区域 */}
              {showPasswordSection && (
                <div className="bg-surface border border-outline p-4 rounded-xl shadow-xs flex flex-col gap-3">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800 dark:text-slate-200">
                    <KeyRound className="w-4 h-4 text-indigo-500" />
                    <span>{t("instance_detail_reset_dashboard_password")}</span>
                  </div>

                  <p className="text-[13px] text-content-muted leading-relaxed">
                    {t("instance_detail_reset_password_prefix")}<strong>{t("instance_detail_reset_password_emphasis")}</strong>{t("instance_detail_reset_password_suffix")}
                  </p>

                  <div className="flex flex-col sm:flex-row gap-2.5 max-w-lg">
                    <div className="relative flex-1">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={t("instance_detail_new_password_placeholder")}
                        className="w-full h-9 pl-3 pr-10 text-[13px] bg-surface-muted border border-outline rounded-lg text-content focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-400 dark:placeholder-slate-600 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                        title={t(showNewPassword ? "instance_detail_hide_password" : "instance_detail_show_password")}
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={handleResetPassword}
                      disabled={resetPasswordLoading || !newPassword.trim()}
                      className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-all disabled:opacity-45 disabled:cursor-not-allowed"
                    >
                      {resetPasswordLoading ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{t(resetPasswordLoading ? "instance_detail_resetting_password" : "instance_detail_reset_and_redeploy")}</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          );
        })()}

        {/* Tab Selection Row */}
        <div className="flex items-center px-4 md:px-6 py-2 border-b border-slate-200/80 dark:border-slate-800 bg-surface-muted/30 gap-1.5 shrink-0 overflow-x-auto sm:overflow-visible">
          <button
            onClick={() => setDetailTab('logs')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 shrink-0",
              detailTab === 'logs'
                ? "bg-slate-200 dark:bg-slate-800 text-content border border-slate-300/60 dark:border-slate-700 shadow-2xs"
                : "text-content-muted hover:text-slate-800 dark:hover:text-slate-200 hover:bg-control-hover"
            )}
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span>{t("instance_detail_logs_tab")}</span>
          </button>

          <button
            onClick={() => setDetailTab('files')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 shrink-0",
              detailTab === 'files'
                ? "bg-slate-200 dark:bg-slate-800 text-content border border-slate-300/60 dark:border-slate-700 shadow-2xs"
                : "text-content-muted hover:text-slate-800 dark:hover:text-slate-200 hover:bg-control-hover"
            )}
          >
            <Folder className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{t("instance_detail_files_tab")}</span>
          </button>

          <button
            onClick={() => setDetailTab('context')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 shrink-0",
              detailTab === 'context'
                ? "bg-slate-200 dark:bg-slate-800 text-content border border-slate-300/60 dark:border-slate-700 shadow-2xs"
                : "text-content-muted hover:text-slate-800 dark:hover:text-slate-200 hover:bg-control-hover"
            )}
          >
            <Briefcase className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>{t("instance_detail_context_tab")}</span>
          </button>

          <button
            onClick={() => setDetailTab('diagnostics')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150 shrink-0",
              detailTab === 'diagnostics'
                ? "bg-slate-200 dark:bg-slate-800 text-content border border-slate-300/60 dark:border-slate-700 shadow-2xs"
                : "text-content-muted hover:text-slate-800 dark:hover:text-slate-200 hover:bg-control-hover"
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{t("instance_detail_diagnostics_tab")}</span>
          </button>

        </div>

        {/* Workspace Working Area Panel */}
        <div className="flex-1 flex flex-col min-h-0 bg-surface-muted overflow-hidden">
          {detailTab === 'logs' ? (
            <LogViewer
              instanceId={activeLogs}
              socket={socket as any}
              isDeploying={selectedInstance.status === 'deploying'}
              instanceStatus={selectedInstance.status}
              activeLogTab={activeLogTab}
              setActiveLogTab={setActiveLogTab}
            />
          ) : detailTab === 'files' ? (
            <div className="flex-1 p-0 overflow-y-auto bg-surface">
              <InstanceFilesSection
                instanceId={selectedInstance.id}
                currentUser={currentUser}
              />
            </div>
          ) : detailTab === 'context' ? (
            <div className="flex-1 p-0 overflow-y-auto bg-surface-muted/50">
              <InstanceRuntimeContextViewer instanceId={selectedInstance.id} />
            </div>
          ) : (
            <InstanceDiagnosticsWorkspace
              instanceId={selectedInstance.id}
              instance={selectedInstance}
              onOpenLogs={() => setDetailTab("logs")}
              onOpenSettings={() => {
                setActiveLogs(null);
                setEditingInstance(selectedInstance);
              }}
              onOpenPasswordReset={() => setShowPasswordSection(true)}
              onRedeploy={() => handleInstanceAction(selectedInstance.id, "redeploy", true, t("confirm_redeploy"))}
            />
          )}
        </div>
      </div>
    </div>
  );

  const targetContainer = typeof document !== "undefined" ? document.getElementById("main-workspace") : null;
  if (targetContainer) {
    return createPortal(panelContent, targetContainer);
  }

  return panelContent;
}
