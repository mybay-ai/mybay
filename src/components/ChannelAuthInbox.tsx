import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { AlertTriangle, Check, Clock3, Loader2, ShieldCheck, UserCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { User } from "../types";
import { api } from "../lib/api";
import { useFeedback } from "./FeedbackProvider";

interface ChannelAuthEvent {
  id: string;
  instance_id: string;
  instance_name: string;
  platform: string;
  external_user_id: string | null;
  external_chat_id: string | null;
  external_channel_id: string | null;
  external_group_id: string | null;
  display_name: string | null;
  raw_payload?: { log_line?: string } | null;
  status: "pending" | "approved" | "ignored";
  last_seen_at?: string;
  created_at: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  telegram: "Telegram",
  feishu: "\u98de\u4e66",
  lark: "\u98de\u4e66",
  weixin: "\u5fae\u4fe1",
  wechat: "\u5fae\u4fe1",
  wecom: "\u4f01\u4e1a\u5fae\u4fe1",
  dingtalk: "\u9489\u9489",
  discord: "Discord",
  slack: "Slack",
};

function identifier(event: ChannelAuthEvent) {
  return event.external_user_id || event.external_chat_id || event.external_channel_id || event.external_group_id || "-";
}

function masked(value: string) {
  return value.length <= 12 ? value : value.slice(0, 7) + "\u2026" + value.slice(-4);
}

function senderLabel(event: ChannelAuthEvent) {
  const value = identifier(event);
  const displayName = String(event.display_name || "").trim();
  return !displayName || displayName === value || displayName.includes(value) ? masked(value) : displayName;
}

function loadSeen(key: string): Set<string> {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
export function ChannelAuthInbox({ currentUser, socket }: { currentUser: User; socket: Socket | null }) {
  const { t, i18n } = useTranslation("dashboard");
  const { showToast } = useFeedback();
  const [events, setEvents] = useState<ChannelAuthEvent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"approve" | "ignore" | null>(null);
  const seenKey = "mybay:channel-auth-seen:" + currentUser.id;
  const seenRef = useRef<Set<string>>(new Set());
  const openRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);

  const markSeen = useCallback((eventId: string) => {
    seenRef.current.add(eventId);
    try {
      sessionStorage.setItem(seenKey, JSON.stringify(Array.from(seenRef.current).slice(-200)));
    } catch {
      // In-memory deduplication remains available when session storage is disabled.
    }
  }, [seenKey]);

  const openEvent = useCallback((event: ChannelAuthEvent, remember = true) => {
    if (remember) markSeen(event.id);
    activeRef.current = event.id;
    openRef.current = true;
    setActiveId(event.id);
    setIsOpen(true);
  }, [markSeen]);

  const closeModal = useCallback(() => {
    openRef.current = false;
    setIsOpen(false);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      try {
        await api.post("/api/instances/channel-auth-events/scan", {});
      } catch (scanError) {
        console.debug("[ChannelAuthInbox] Background scan unavailable; using persisted events", scanError);
      }
      const data = await api.get<ChannelAuthEvent[]>("/api/instances/channel-auth-events/pending");
      const pending = Array.isArray(data) ? data.filter((event) => event.status === "pending") : [];
      setEvents(pending);
      if (pending.length === 0) {
        activeRef.current = null;
        openRef.current = false;
        setActiveId(null);
        setIsOpen(false);
        return;
      }
      if (openRef.current && pending.some((event) => event.id === activeRef.current)) return;
      if (openRef.current) {
        activeRef.current = null;
        openRef.current = false;
        setActiveId(null);
        setIsOpen(false);
      }
      const unseen = pending.find((event) => !seenRef.current.has(event.id));
      if (unseen) openEvent(unseen);
    } catch (error) {
      console.error("[ChannelAuthInbox] Failed to fetch pending events", error);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
    }
  }, [openEvent]);

  useEffect(() => {
    seenRef.current = loadSeen(seenKey);
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const handleChanged = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    socket?.on("channel_auth_events_changed", handleChanged);
    socket?.on("connect", handleChanged);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      socket?.off("channel_auth_events_changed", handleChanged);
      socket?.off("connect", handleChanged);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, seenKey, socket]);

  const active = useMemo(() => events.find((event) => event.id === activeId) || events[0] || null, [activeId, events]);

  const finish = useCallback((eventId: string) => {
    setEvents((current) => current.filter((event) => event.id !== eventId));
    activeRef.current = null;
    openRef.current = false;
    setActiveId(null);
    setIsOpen(false);
    window.setTimeout(() => void refresh(), 250);
  }, [refresh]);

  const approve = async () => {
    if (!active || action) return;
    setAction("approve");
    try {
      const result = await api.post("/api/instances/" + active.instance_id + "/channel-auth-events/" + active.id + "/approve", {});
      showToast(result?.postCheck?.message || t("channel_auth_global_approved"), result?.postCheck?.status === "failed" ? "warning" : "success", 5000);
      finish(active.id);
    } catch (error: any) {
      showToast(error?.message || t("channel_auth_global_approve_failed"), "error", 5000);
    } finally {
      setAction(null);
    }
  };

  const ignore = async () => {
    if (!active || action) return;
    setAction("ignore");
    try {
      await api.post("/api/instances/" + active.instance_id + "/channel-auth-events/" + active.id + "/ignore", {});
      showToast(t("channel_auth_global_ignored"), "info");
      finish(active.id);
    } catch (error: any) {
      showToast(error?.message || t("channel_auth_global_ignore_failed"), "error");
    } finally {
      setAction(null);
    }
  };

  if (loading && events.length === 0) return null;

  return (
    <>
      {events.length > 0 && !isOpen && (
        <button type="button" onClick={() => openEvent(events[0], false)} className="fixed bottom-6 right-6 z-[90] flex items-center gap-2 rounded-full border border-amber-200 bg-surface px-4 py-3 text-sm font-semibold text-content shadow-xl shadow-slate-900/15 transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-2xl" aria-label={t("channel_auth_global_open")}>
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <ShieldCheck className="h-5 w-5" />
            <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">{events.length > 99 ? "99+" : events.length}</span>
          </span>
          <span className="hidden sm:block">{t("channel_auth_global_pending")}</span>
        </button>
      )}
      <AnimatePresence>
        {isOpen && active && (
          <div className="fixed inset-0 z-[9980] flex items-center justify-center p-4">
            <motion.button type="button" aria-label={t("common_close")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeModal} className="absolute inset-0 h-full w-full bg-slate-950/55 backdrop-blur-sm" />
            <motion.section role="dialog" aria-modal="true" aria-labelledby="channel-auth-dialog-title" initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} className="relative z-[9981] flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-outline bg-surface shadow-2xl">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-outline px-5 py-5 sm:px-6">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><UserCheck className="h-6 w-6" /></div>
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2"><h2 id="channel-auth-dialog-title" className="text-lg font-bold leading-6 text-content">{t("channel_auth_global_title")}</h2>{events.length > 1 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">{events.length}</span>}</div>
                    <p className="text-sm leading-5 text-content-muted">{t("channel_auth_global_description")}</p>
                  </div>
                </div>
                <button type="button" onClick={closeModal} aria-label={t("common_close")} className="shrink-0 rounded-xl p-2 text-content-muted transition hover:bg-control-hover hover:text-content-secondary"><X className="h-5 w-5" /></button>
              </div>
              <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
                <div className="rounded-2xl border border-outline bg-surface-muted/70 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><span className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">{PLATFORM_LABELS[active.platform.toLowerCase()] || active.platform}</span><span className="flex items-center gap-1.5 text-xs text-content-muted"><Clock3 className="h-3.5 w-3.5" />{new Date(active.last_seen_at || active.created_at).toLocaleString(i18n.resolvedLanguage === "en" ? "en-US" : "zh-CN")}</span></div>
                  <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
                    <dt className="text-content-muted">{t("channel_auth_global_instance")}</dt><dd className="min-w-0 break-words font-semibold text-content" title={active.instance_name}>{active.instance_name}</dd>
                    <dt className="text-content-muted">{t("channel_auth_global_sender")}</dt><dd className="min-w-0 break-all font-semibold text-content" title={active.display_name || identifier(active)}>{senderLabel(active)}</dd>
                    <dt className="text-content-muted">{t("channel_auth_global_identifier")}</dt><dd className="min-w-0 break-all font-mono text-xs text-content-secondary" title={identifier(active)}>{masked(identifier(active))}</dd>
                  </dl>
                </div>
                <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("channel_auth_global_warning")}</span></div>
                {active.raw_payload?.log_line && <details className="group rounded-xl border border-outline bg-surface"><summary className="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-content-muted hover:text-content">{t("channel_auth_global_evidence")}</summary><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all border-t border-outline bg-slate-950 p-3 text-[11px] leading-5 text-slate-300">{active.raw_payload.log_line}</pre></details>}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-outline bg-surface-muted/70 px-5 py-4 sm:px-6">
                <button type="button" onClick={ignore} disabled={Boolean(action)} className="w-full rounded-xl border border-outline bg-surface px-3 py-2.5 text-sm font-semibold text-content-secondary transition hover:bg-control-hover disabled:opacity-50">{action === "ignore" ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("channel_auth_ignore")}</button>
                <button type="button" onClick={closeModal} disabled={Boolean(action)} className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-content-muted transition hover:bg-control-hover disabled:opacity-50">{t("channel_auth_global_later")}</button>
                <button type="button" onClick={approve} disabled={Boolean(action)} className="col-span-2 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-60">{action === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("channel_auth_approve")}</button>
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
