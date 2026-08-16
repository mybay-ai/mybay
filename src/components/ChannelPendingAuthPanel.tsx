import { useState, useEffect, useRef } from "react";
import { Shield, Check, X, ShieldAlert, Loader2, RefreshCw, UserCheck, MessageSquare, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "./ui";
import { cn } from "../lib/utils";
import type { AgentInstance } from "../types";
import { useTranslation } from "react-i18next";
import { useFeedback } from "./FeedbackProvider";

import { api } from "../lib/api";
import { ChannelAcceptanceCard } from "./ChannelAcceptanceCard";

interface AuthEvent {
  id: string;
  instance_id: string;
  platform: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  external_channel_id: string | null;
  external_group_id: string | null;
  display_name: string | null;
  status: 'pending' | 'approved' | 'ignored';
  raw_payload: any;
  created_at: string;
  updated_at: string;
}

export function ChannelPendingAuthPanel({ 
  instance, 
  currentUser 
}: { 
  instance: AgentInstance; 
  currentUser: any; 
}) {
  const { t, i18n } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [currentAllowMode, setCurrentAllowMode] = useState<string>("bind_later");
  const [savingMode, setSavingMode] = useState(false);
  const [showLogId, setShowLogId] = useState<string | null>(null);

  // Short polling re-check states
  const [pollingStatus, setPollingStatus] = useState<'idle' | 'checking' | 'success' | 'awaiting' | 'timeout' | 'reload_required' | 'failed'>('idle');
  const [pollingMessage, setPollingMessage] = useState<string>("");
  const [pollingSecondsLeft, setPollingSecondsLeft] = useState<number>(0);
  const [lastApprovedPlatform, setLastApprovedPlatform] = useState<string>("telegram");
  const pollingIntervalRef = useRef<any>(null);

  const t_checking = t("channel_auth_checking_after_approve");
  const t_success = t("channel_auth_check_success");
  const t_waiting = t("channel_auth_check_waiting_message");
  const t_timeout = t("channel_auth_check_timeout");
  const t_reload_required = t("channel_auth_check_reload_required");
  const t_failed = t("channel_auth_check_failed");
  const t_refresh = t("channel_status_refresh");

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const startShortPollingCheck = (platform: string) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    setPollingStatus("checking");
    setPollingMessage(t_checking);
    setPollingSecondsLeft(60);
    
    let secondsLeft = 60;
    const intervalTime = 5000;
    
    pollingIntervalRef.current = setInterval(async () => {
      secondsLeft -= 5;
      setPollingSecondsLeft(secondsLeft);
      
      if (secondsLeft <= 0) {
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setPollingStatus("timeout");
        setPollingMessage(t_timeout);
        return;
      }
      
      try {
        const res = await api.get(`/api/instances/${instance.id}/channel-status`);
        if (res && res.success) {
          window.dispatchEvent(new CustomEvent("instance-channel-updated", {
            detail: {
              instanceId: instance.id,
              channelStatus: res.channel_status || {},
              connectedCount: res.connectedCount,
              totalCount: res.totalCount,
              gatewayReady: res.gateway_ready
            }
          }));
          
          const chanStatus = res.channel_status?.[platform];
          const statusStr = typeof chanStatus === 'object' && chanStatus !== null ? chanStatus.status : String(chanStatus || "");
          
          if (statusStr === "pending") {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            setPollingStatus("awaiting");
            setPollingMessage(t("channel_auth_telegram_confirmation_required"));
          } else if (statusStr === "connected" || (chanStatus?.authorizationApproved === true && statusStr !== "pending")) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            setPollingStatus("success");
            setPollingMessage(t_success);
          } else if (statusStr === "awaiting_authorization") {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            setPollingStatus("awaiting");
            setPollingMessage(t_waiting);
          }
        }
      } catch (err) {
        console.error("[Polling] Failed to check channel status", err);
      }
    }, intervalTime);
  };

  // Parse allowMode from instance configSummary or config_json (deprecated)
  useEffect(() => {
    if (instance.configSummary?.allowMode) {
      setCurrentAllowMode(instance.configSummary.allowMode);
    } else if (instance.config_json) {
      try {
        const parsed = JSON.parse(instance.config_json);
        if (parsed.allowMode) {
          setCurrentAllowMode(parsed.allowMode);
        } else if (parsed.gatewayAllowAllUsers === true) {
          setCurrentAllowMode("allow_all");
        } else {
          setCurrentAllowMode("bind_later");
        }
      } catch (e) {
        // use default
      }
    }
  }, [instance.config_json, instance.configSummary?.allowMode]);

  // Handle cross-component anchor activation and scroll mapping
  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setTimeout(() => {
        const el = document.getElementById("auth-permission-panel");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
    };
    window.addEventListener("open-auth-panel", handleOpen);
    return () => window.removeEventListener("open-auth-panel", handleOpen);
  }, []);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/instances/${instance.id}/channel-auth-events`);
      if (data) {
        setEvents(data);
      }
    } catch (e) {
      console.error("[AuthPanel] Failed to fetch auth events", e);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    setLoading(true);
    try {
      const data = await api.post(`/api/instances/${instance.id}/channel-auth-events/scan`, {});
      if (data) {
        setEvents(data);
      }
    } catch (e) {
      console.error("[AuthPanel] Failed to scan auth events", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchEvents();
      // Auto refresh every 7 seconds when open
      const interval = setInterval(fetchEvents, 7000);
      return () => clearInterval(interval);
    }
  }, [isOpen, instance.id]);

  const handleApprove = async (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation();
    setActionLoadingId(eventId);
    try {
      const data = await api.post(`/api/instances/${instance.id}/channel-auth-events/${eventId}/approve`, {});
      if (data && data.success) {
        await fetchEvents();
        const platform = data.event?.platform || "telegram";
        setLastApprovedPlatform(platform);
        
        const postCheck = data.postCheck;
        if (postCheck) {
          if (postCheck.status === "reload_required") {
            setPollingStatus("reload_required");
            setPollingMessage(t_reload_required);
          } else if (postCheck.status === "connected") {
            setPollingStatus("success");
            setPollingMessage(t_success);
            
            // Dispatch dynamic state update locally
            window.dispatchEvent(new CustomEvent("instance-channel-updated", {
              detail: {
                instanceId: instance.id,
                channelStatus: data.channel_status || {},
                connectedCount: data.channel_status ? Object.values(data.channel_status).filter((c: any) => c.status === "connected").length : 0,
                totalCount: data.channel_status ? Object.keys(data.channel_status).length : 0,
                gatewayReady: true
              }
            }));
          } else if (postCheck.status === "pending") {
            setPollingStatus("awaiting");
            setPollingMessage(t("channel_auth_external_confirmation_required"));
          } else {
            startShortPollingCheck(platform);
          }
        } else {
          startShortPollingCheck(platform);
        }
      } else {
        showAlert({
          title: t("channel_auth_approve_failed_title"),
          message: t("channel_auth_approve_failed_message"),
          type: "error"
        });
      }
    } catch (err: any) {
      console.error(err);
      showAlert({
        title: t("channel_auth_approve_failed_title"),
        message: t("channel_auth_network_error"),
        type: "error",
        details: err?.message || ""
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleIgnore = async (e: React.MouseEvent, eventId: string) => {
    e.stopPropagation();
    setActionLoadingId(eventId);
    try {
      const data = await api.post(`/api/instances/${instance.id}/channel-auth-events/${eventId}/ignore`, {});
      if (data) {
        await fetchEvents();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleUpdateAllowMode = async (mode: string) => {
    setSavingMode(true);
    try {
      const data = await api.post(`/api/instances/${instance.id}/allow-mode`, { allowMode: mode });
      if (data) {
        setCurrentAllowMode(mode);
        showToast(t("channel_auth_policy_updated"), "success");
      } else {
        showAlert({
          title: t("channel_auth_policy_update_failed_title"),
          message: t("channel_auth_policy_rejected"),
          type: "error"
        });
      }
    } catch (err: any) {
      console.error(err);
      showAlert({
        title: t("channel_auth_policy_update_failed_title"),
        message: t("channel_auth_policy_network_error"),
        type: "error",
        details: err?.message || ""
      });
    } finally {
      setSavingMode(false);
    }
  };

  const pendingEvents = events.filter(e => e.status === 'pending');

  const getPlatformLabel = (platform: string) => {
    const labels: Record<string, string> = {
      feishu: t("channel_platform_feishu"),
      telegram: "Telegram",
      weixin: t("channel_platform_weixin"),
      discord: "Discord",
      wecom: t("channel_platform_wecom"),
      dingtalk: t("channel_platform_dingtalk"),
      slack: "Slack",
      qq_bot: t("channel_platform_qq_bot"),
      wechat_mp: t("channel_platform_wechat_mp"),
      webhook: "Webhook",
      whatsapp: "WhatsApp"
    };
    return labels[platform] || platform;
  };

  return (
    <div id="auth-permission-panel" className="border border-outline/40 rounded-2xl overflow-hidden bg-surface shadow-sm mt-3" onClick={e => e.stopPropagation()}>
      <button 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="w-full flex items-center justify-between p-4 bg-surface-muted/10 hover:bg-surface-muted/50 transition-colors text-left"
      >
        <div className="min-w-0 pr-4">
          <h5 className="text-[12px] font-semibold text-content-secondary flex items-center gap-1.5 mb-0.5">
            <Shield className="w-3.5 h-3.5 text-blue-550 shrink-0" />
            <span>{t("channel_auth_panel_title")}</span>
            {pendingEvents.length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700 animate-pulse">
                {t("channel_auth_pending_count", { count: pendingEvents.length })}
              </span>
            )}
          </h5>
          <p className="text-[11px] text-content-muted leading-normal truncate">{t("channel_auth_panel_description")}</p>
        </div>
        <div className="shrink-0 p-1.5 bg-control-hover hover:bg-slate-200 rounded-lg text-content-muted transition-colors">
          {isOpen ? <X className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-1 bg-surface border-t border-outline space-y-4 text-xs">
          
          {/* Polling / Checking Status Banner */}
          {pollingStatus !== 'idle' && (
            <div className={cn(
              "p-3 rounded-xl border flex items-start gap-2.5 leading-normal",
              pollingStatus === 'checking' && "bg-blue-50/40 border-blue-100 text-blue-900",
              pollingStatus === 'success' && "bg-emerald-50/40 border-emerald-100 text-emerald-900",
              pollingStatus === 'awaiting' && "bg-amber-50/40 border-amber-100 text-amber-900",
              pollingStatus === 'timeout' && "bg-rose-50/40 border-rose-100 text-rose-900",
              pollingStatus === 'reload_required' && "bg-indigo-50/40 border-indigo-100 text-indigo-900",
              pollingStatus === 'failed' && "bg-surface-muted border-outline text-content-secondary"
            )}>
              <div className="shrink-0 mt-0.5">
                {pollingStatus === 'checking' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                {pollingStatus === 'success' && <Check className="w-4 h-4 text-emerald-500" />}
                {pollingStatus === 'awaiting' && <AlertCircle className="w-4 h-4 text-amber-500" />}
                {pollingStatus === 'timeout' && <AlertCircle className="w-4 h-4 text-rose-500" />}
                {pollingStatus === 'reload_required' && <Shield className="w-4 h-4 text-indigo-500" />}
                {pollingStatus === 'failed' && <AlertCircle className="w-4 h-4 text-content-muted" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[11px] flex items-center justify-between">
                  <span>
                    {pollingStatus === 'checking' && t("channel_auth_status_checking")}
                    {pollingStatus === 'success' && t("channel_auth_status_success")}
                    {pollingStatus === 'awaiting' && t("channel_auth_status_awaiting")}
                    {pollingStatus === 'timeout' && t("channel_auth_status_timeout")}
                    {pollingStatus === 'reload_required' && t("channel_auth_status_reload_required")}
                    {pollingStatus === 'failed' && t("channel_auth_status_failed")}
                  </span>
                  {pollingStatus === 'checking' && (
                    <span className="font-mono text-[9px] text-blue-400 font-normal">
                      {t("channel_auth_seconds_remaining", { count: pollingSecondsLeft })}
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-content-muted mt-0.5">{pollingMessage}</p>
                {(pollingStatus === 'timeout' || pollingStatus === 'failed' || pollingStatus === 'awaiting') && (
                  <button
                    onClick={() => startShortPollingCheck(lastApprovedPlatform)}
                    className="mt-1.5 text-[10px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>{pollingStatus === 'awaiting' ? t("channel_auth_sent_recheck") : t_refresh}</span>
                  </button>
                )}
              </div>
              <button 
                onClick={() => setPollingStatus('idle')}
                className="shrink-0 text-content-muted hover:text-slate-650 bg-transparent border-0 p-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          
          <ChannelAcceptanceCard
            instanceId={instance.id}
            channel={instance.configSummary?.channel || (() => { try { return JSON.parse(instance.config_json || "{}").channel; } catch { return "web"; } })()}
          />

          {/* Permission Mode Control Row */}
          <div className="p-3 bg-surface-muted rounded-xl space-y-1.5">
            <span className="font-semibold text-content-secondary text-[11px] block">{t("channel_auth_policy_title")}</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: "bind_later", label: t("channel_auth_policy_capture"), desc: t("channel_auth_policy_capture_desc") },
                { id: "allowlist", label: t("channel_auth_policy_allowlist"), desc: t("channel_auth_policy_allowlist_desc") },
                { id: "allow_all", label: t("channel_auth_policy_allow_all"), desc: t("channel_auth_policy_allow_all_desc") },
                { id: "disabled", label: t("channel_auth_policy_disabled"), desc: t("channel_auth_policy_disabled_desc") }
              ].map((item) => (
                <button
                  key={item.id}
                  disabled={savingMode}
                  onClick={() => handleUpdateAllowMode(item.id)}
                  className={cn(
                    "p-2 rounded-lg border text-left transition-all active:scale-95 disabled:opacity-50",
                    currentAllowMode === item.id 
                      ? "border-blue-500 bg-blue-50/40 text-blue-900" 
                      : "border-outline/40 bg-surface text-content-secondary hover:bg-surface-muted"
                  )}
                >
                  <span className="font-semibold text-[11px] block">{item.label}</span>
                  <span className="text-[11px] text-content-muted block mt-0.5 leading-tight">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pending Events Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-outline/40 pb-1.5 mb-1 text-[11px] text-content-muted font-semibold">
              <span>{t("channel_auth_pending_events", { count: pendingEvents.length })}</span>
              <button 
                onClick={handleScan} 
                disabled={loading}
                className="text-blue-500 hover:text-blue-700 inline-flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                {t("channel_auth_refresh_capture")}
              </button>
            </div>

            {loading && events.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-450 gap-2">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <span>{t("channel_auth_loading_events")}</span>
              </div>
            ) : pendingEvents.length === 0 ? (
              <div className="py-5 bg-surface-muted/50 rounded-xl border border-dashed border-outline/40 text-center text-content-muted select-none">
                <Check className="w-5 h-5 text-emerald-500 mx-auto mb-1.5" />
                <p className="font-semibold text-[11px]">{t("channel_auth_empty_title")}</p>
                <p className="text-[10px] text-content-muted mt-0.5">{t("channel_auth_empty_description")}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {pendingEvents.map((event) => {
                  const targetId = String(event.external_user_id || event.external_chat_id || event.external_channel_id || event.external_group_id || "");
                  const idType = event.external_user_id ? t("channel_auth_user_id") : event.external_chat_id ? t("channel_auth_chat_id") : event.external_channel_id ? t("channel_auth_channel_id") : t("channel_auth_group_id");
                  const rawLog = event.raw_payload?.log_line || event.raw_payload?.line || "";
                  const logLine = typeof rawLog === 'object' ? JSON.stringify(rawLog) : String(rawLog || "");

                  return (
                    <div 
                      key={event.id} 
                      className="p-3 bg-surface border border-outline/40 rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 leading-relaxed hover:border-outline-strong transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold text-[11px] uppercase">
                            {getPlatformLabel(event.platform)}
                          </span>
                          <span className="text-[11px] font-semibold text-content-secondary truncate">
                            {event.display_name || t("channel_auth_unknown_source")}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-content-muted flex items-center gap-1 select-all break-all">
                          {event.external_user_id ? <UserCheck className="w-3 h-3 text-content-muted shrink-0" /> : <MessageSquare className="w-3 h-3 text-content-muted shrink-0" />}
                          <span className="font-semibold text-slate-605">{idType}:</span> {targetId}
                        </div>
                        
                        {logLine && (
                          <div className="mt-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowLogId(showLogId === event.id ? null : event.id);
                              }}
                              className="text-[11px] text-content-muted hover:text-content-secondary inline-flex items-center gap-1 font-semibold"
                            >
                              {showLogId === event.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              <span>{showLogId === event.id ? t("channel_auth_hide_log_evidence") : t("channel_auth_show_log_evidence")}</span>
                            </button>
                            
                            {showLogId === event.id && (
                              <pre className="mt-1 p-2 bg-slate-900 text-slate-300 font-mono text-[11px] rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                                {logLine}
                              </pre>
                            )}
                          </div>
                        )}
                        
                        <div className="text-[11px] text-content-muted">
                          {t("channel_auth_captured_at", { time: new Date(event.created_at).toLocaleString(i18n.resolvedLanguage || i18n.language) })}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 justify-end shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => handleIgnore(e, event.id)}
                          disabled={actionLoadingId === event.id}
                          className="h-7 px-2.5 text-[11px] font-semibold text-content-muted hover:text-content"
                        >
                          {t("channel_auth_ignore")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={(e) => handleApprove(e, event.id)}
                          disabled={actionLoadingId === event.id}
                          className="h-7 px-2.5 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shadow-sm"
                        >
                          {actionLoadingId === event.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          {t("channel_auth_approve")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Historic Events (Approved) Summary */}
          {events.some(e => e.status === 'approved') && (
            <div className="pt-2 border-t border-outline/40">
              <span className="text-[11px] text-content-muted font-semibold block mb-1">{t("channel_auth_recent_approved")}</span>
              <div className="flex flex-col gap-1.5">
                {events.filter(e => e.status === 'approved').slice(0, 8).map((event) => {
                  const target = event.external_user_id || event.external_chat_id || event.external_channel_id || event.external_group_id || "";
                  return (
                    <div 
                      key={event.id}
                      className="flex items-center justify-between p-1.5 rounded-lg bg-surface-muted/50 text-content-secondary border border-outline/40 text-[11px]"
                      title={t("channel_auth_history_tooltip", { target })}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse"></div>
                        <span className="text-content-muted font-semibold">{getPlatformLabel(event.platform)}:</span>
                        <span className="font-mono text-content-secondary truncate max-w-[150px]" title={target}>
                          {event.display_name || target}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-[11px] font-semibold">
                        <span className="text-blue-600 bg-blue-50 px-1 py-0.2 rounded border border-blue-100">APPROVED</span>
                        <span className="text-indigo-600 bg-indigo-50 px-1 py-0.2 rounded border border-indigo-100">APPLIED</span>
                        <span className="text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-100">RELOADED</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
