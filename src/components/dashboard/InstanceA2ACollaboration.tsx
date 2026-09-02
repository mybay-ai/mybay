import React from "react";
import { ArrowDownLeft, ArrowUpRight, Bot, CheckCircle2, Clock3, GitFork, History, Loader2, Network, RefreshCw, RotateCw, Save, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentInstance } from "../../types";
import { api } from "../../lib/api";
import { Button, Card, cn } from "../ui";
import { useFeedback } from "../FeedbackProvider";
import { isRetryableA2AStatus } from "../chat-workspace/a2aRetryNavigation";

type A2AView = {
  instanceId: string;
  version: string;
  supported: boolean;
  enabled: boolean;
  agentName: string;
  port: number;
  exposure: "internal_only";
  internalUrl: string;
  hasToken: boolean;
  peerIds: string[];
  rateLimit: number;
  maxPingPongTurns: number;
  peers: Array<{ id: string; name: string; version: string; supported: boolean; enabled: boolean; status: string; capabilities: string[] }>;
};

type A2AActivity = {
  contextId: string;
  taskId: string;
  direction: "inbound" | "outbound";
  peerId: string | null;
  peerName: string;
  status: A2AActivityStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: string;
  result: string | null;
  failureReason: string | null;
};

type A2AActivityStatus = "completed" | "in_progress" | "connection_failed" | "timed_out" | "agent_offline" | "auth_failed" | "cancelled" | "failed";

type A2AOrchestration = {
  contextId: string;
  status: "completed" | "partial" | "failed" | "in_progress";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  nodes: A2AActivity[];
};

type A2AStatusView = {
  state: "ready" | "unreachable" | "invalid_card" | "disabled" | "unknown";
  peers?: Array<{ id: string; state: "ready" | "unreachable" | "invalid_card"; statusCode: number; durationMs: number; error?: string }>;
  generatedAt?: string;
  error?: string;
};

export function InstanceA2ACollaboration({ instance, onRedeploy, onRetryInChat, onOpenPeer }: { instance: AgentInstance; onRedeploy: () => void; onRetryInChat: (draft: string) => void; onOpenPeer: (peerId: string) => void }) {
  const { t, i18n } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [view, setView] = React.useState<A2AView | null>(null);
  const [status, setStatus] = React.useState<A2AStatusView | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [activityLoading, setActivityLoading] = React.useState(false);
  const [activities, setActivities] = React.useState<A2AActivity[]>([]);
  const [orchestrations, setOrchestrations] = React.useState<A2AOrchestration[]>([]);
  const [enabled, setEnabled] = React.useState(false);
  const [agentName, setAgentName] = React.useState(instance.name);
  const [peerIds, setPeerIds] = React.useState<string[]>([]);
  const [peerCapabilities, setPeerCapabilities] = React.useState<Record<string, string>>({});
  const currentInstanceIdRef = React.useRef(instance.id);
  const viewRequestIdRef = React.useRef(0);
  const statusRequestIdRef = React.useRef(0);
  const activityRequestIdRef = React.useRef(0);
  currentInstanceIdRef.current = instance.id;

  const load = React.useCallback(async () => {
    const targetInstanceId = instance.id;
    const requestId = ++viewRequestIdRef.current;
    setLoading(true);
    try {
      const next = await api.get<A2AView>(`/api/instances/${targetInstanceId}/a2a`);
      if (currentInstanceIdRef.current !== targetInstanceId || viewRequestIdRef.current !== requestId) return;
      setView(next);
      setStatus(null);
      setActivities([]);
      setOrchestrations([]);
      setEnabled(next.enabled);
      setAgentName(next.agentName);
      setPeerIds(next.peerIds);
      setPeerCapabilities(Object.fromEntries(next.peers.map((peer) => [peer.id, (peer.capabilities || []).join(", ")])));
    } catch (error: any) {
      if (currentInstanceIdRef.current !== targetInstanceId || viewRequestIdRef.current !== requestId) return;
      await showAlert({ title: t("a2a.loadFailedTitle"), message: error.message || t("a2a.loadFailed"), type: "error" });
    } finally {
      if (currentInstanceIdRef.current === targetInstanceId && viewRequestIdRef.current === requestId) setLoading(false);
    }
  }, [instance.id, showAlert, t]);

  const checkStatus = React.useCallback(async () => {
    const targetInstanceId = instance.id;
    const requestId = ++statusRequestIdRef.current;
    setChecking(true);
    try {
      const nextStatus = await api.get<A2AStatusView>(`/api/instances/${targetInstanceId}/a2a/status`);
      if (currentInstanceIdRef.current !== targetInstanceId || statusRequestIdRef.current !== requestId) return;
      setStatus(nextStatus);
    } catch (error: any) {
      if (currentInstanceIdRef.current !== targetInstanceId || statusRequestIdRef.current !== requestId) return;
      setStatus({ state: "unreachable", error: error.code || "A2A_CONNECT_FAILED" });
    } finally {
      if (currentInstanceIdRef.current === targetInstanceId && statusRequestIdRef.current === requestId) setChecking(false);
    }
  }, [instance.id]);

  const loadActivity = React.useCallback(async () => {
    const targetInstanceId = instance.id;
    const requestId = ++activityRequestIdRef.current;
    setActivityLoading(true);
    try {
      const result = await api.get<{ activities: A2AActivity[]; orchestrations?: A2AOrchestration[] }>(`/api/instances/${targetInstanceId}/a2a/activity?limit=12`);
      if (currentInstanceIdRef.current !== targetInstanceId || activityRequestIdRef.current !== requestId) return;
      setActivities(Array.isArray(result.activities) ? result.activities : []);
      setOrchestrations(Array.isArray(result.orchestrations) ? result.orchestrations : []);
    } catch {
      if (currentInstanceIdRef.current !== targetInstanceId || activityRequestIdRef.current !== requestId) return;
      setActivities([]);
      setOrchestrations([]);
    } finally {
      if (currentInstanceIdRef.current === targetInstanceId && activityRequestIdRef.current === requestId) setActivityLoading(false);
    }
  }, [instance.id]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (view?.enabled) void checkStatus(); else setStatus({ state: "disabled" }); }, [view?.enabled, checkStatus]);
  React.useEffect(() => { if (view?.enabled) void loadActivity(); else { setActivities([]); setOrchestrations([]); } }, [view?.enabled, loadActivity]);
  React.useEffect(() => {
    if (!view?.enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void checkStatus();
      void loadActivity();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [view?.enabled, checkStatus, loadActivity]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.put(`/api/instances/${instance.id}/a2a`, {
        enabled,
        agentName,
        peerIds,
        peerCapabilities: Object.fromEntries(peerIds.map((peerId) => [peerId, parseCapabilityText(peerCapabilities[peerId])])),
        rateLimit: view?.rateLimit || 60,
        maxPingPongTurns: view?.maxPingPongTurns || 5,
      });
      setView(result.config);
      showToast(t("a2a.savedRedeployRequired"), "success", 5000);
    } catch (error: any) {
      await showAlert({ title: t("a2a.saveFailedTitle"), message: error.message || t("a2a.saveFailed"), type: "error", details: error.code });
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async () => {
    const confirmed = await showConfirm({
      title: t("a2a.rotateTitle"),
      message: t("a2a.rotateDescription"),
      type: "danger",
      confirmText: t("a2a.rotateConfirm"),
      cancelText: t("a2a.cancel"),
    });
    if (!confirmed) return;
    try {
      await api.post(`/api/instances/${instance.id}/a2a/rotate-token`);
      showToast(t("a2a.rotatedRedeployRequired"), "success", 5000);
      await load();
    } catch (error: any) {
      await showAlert({ title: t("a2a.rotateFailedTitle"), message: error.message || t("a2a.rotateFailed"), type: "error" });
    }
  };

  if (loading || view?.instanceId !== instance.id) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>;
  if (!view) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-muted/50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-content"><Network className="h-5 w-5 text-violet-600" />{t("a2a.title")}</h3>
            <p className="mt-1 text-[13px] leading-5 text-content-muted">{t("a2a.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={checkStatus} disabled={checking || !view.enabled}><RefreshCw className={cn("mr-1.5 h-4 w-4", checking && "animate-spin")} />{t("a2a.checkStatus")}</Button>
            <Button onClick={onRedeploy} className="bg-indigo-600 text-white"><RotateCw className="mr-1.5 h-4 w-4" />{t("a2a.redeploy")}</Button>
          </div>
        </div>

        {!view.supported ? (
          <Card className="border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><div className="font-bold text-amber-900 dark:text-amber-200">{t("a2a.unsupportedTitle")}</div><p className="mt-1 text-sm text-amber-800/80 dark:text-amber-300/80">{t("a2a.unsupportedDescription", { version: view.version || t("a2a.unknownVersion") })}</p></div></div>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatusCard label={t("a2a.protocolStatus")} value={view.enabled ? t("a2a.enabled") : t("a2a.disabled")} ready={view.enabled} />
              <StatusCard label={t("a2a.runtimeStatus")} value={t(`a2a.states.${status?.state || "unknown"}`)} ready={status?.state === "ready"} />
              <StatusCard label={t("a2a.exposure")} value={t("a2a.internalOnly")} ready />
            </div>

            <Card className="space-y-4 p-4 sm:p-5">
              <label className="flex items-start justify-between gap-4">
                <div><div className="font-bold text-content">{t("a2a.enableTitle")}</div><p className="mt-1 text-xs leading-5 text-content-muted">{t("a2a.enableDescription")}</p></div>
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="mt-1 h-5 w-5 accent-indigo-600" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-xs font-bold text-content-secondary">{t("a2a.agentName")}</span><input value={agentName} onChange={(event) => setAgentName(event.target.value)} maxLength={64} className="mt-1.5 h-10 w-full rounded-xl border border-outline bg-surface px-3 text-sm text-content outline-none focus:border-indigo-400" /></label>
                <div><span className="text-xs font-bold text-content-secondary">{t("a2a.internalEndpoint")}</span><div className="mt-1.5 rounded-xl border border-outline bg-surface-muted px-3 py-2.5 font-mono text-xs text-content-muted">{view.internalUrl}</div></div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300"><ShieldCheck className="mr-1.5 inline h-4 w-4" />{t("a2a.securityNotice")}</div>
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="mb-3"><div className="font-bold text-content">{t("a2a.trustedPeers")}</div><p className="mt-1 text-xs text-content-muted">{t("a2a.trustedPeersDescription")}</p></div>
              {view.peers.length === 0 ? <div className="rounded-xl border border-dashed border-outline p-6 text-center text-sm text-content-muted">{t("a2a.noPeers")}</div> : <div className="grid items-start gap-2 sm:grid-cols-2">{view.peers.map((peer) => {
                const disabled = !peer.supported;
                const selected = peerIds.includes(peer.id);
                const liveState = status?.peers?.find((item) => item.id === peer.id)?.state;
                return <div key={peer.id} className={cn("rounded-xl border border-outline bg-surface p-3", disabled && "opacity-55")}><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => setPeerIds((current) => event.target.checked ? [...current, peer.id] : current.filter((id) => id !== peer.id))} className="mt-1 h-4 w-4 accent-indigo-600" /><Bot className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" /><div className="min-w-0"><div className="truncate text-sm font-bold text-content">{peer.name}</div><div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-content-muted"><span>{peer.version || t("a2a.unknownVersion")} · {t(peer.enabled ? "a2a.peerEnabled" : "a2a.peerNeedsEnable")}</span>{selected && liveState && <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold", liveState === "ready" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300")}><span className={cn("h-1.5 w-1.5 rounded-full", liveState === "ready" ? "bg-emerald-500" : "bg-amber-500")} />{t(`a2a.states.${liveState}`)}</span>}</div></div></label>{selected && <label className="mt-3 block border-t border-outline pt-3"><span className="text-[11px] font-bold text-content-secondary">{t("a2a.peerCapabilities")}</span><input value={peerCapabilities[peer.id] || ""} onChange={(event) => setPeerCapabilities((current) => ({ ...current, [peer.id]: event.target.value }))} maxLength={264} placeholder={t("a2a.peerCapabilitiesPlaceholder")} className="mt-1.5 h-9 w-full rounded-lg border border-outline bg-surface-muted px-2.5 text-xs text-content outline-none focus:border-indigo-400" /><span className="mt-1 block text-[10px] leading-4 text-content-muted">{t("a2a.peerCapabilitiesHint")}</span></label>}</div>;
              })}</div>}
            </Card>

            {orchestrations.length > 0 && <Card className="p-4 sm:p-5">
              <div className="mb-3"><div className="flex items-center gap-2 font-bold text-content"><GitFork className="h-4 w-4 text-violet-500" />{t("a2a.orchestrationTimeline")}</div><p className="mt-1 text-xs text-content-muted">{t("a2a.orchestrationTimelineDescription")}</p></div>
              <div className="space-y-3">{orchestrations.map((orchestration) => {
                const complete = orchestration.status === "completed";
                const partial = orchestration.status === "partial";
                const failed = orchestration.status === "failed";
                const duration = orchestration.durationMs == null ? t("a2a.durationPending") : orchestration.durationMs < 1000 ? `${orchestration.durationMs} ms` : `${(orchestration.durationMs / 1000).toFixed(1)} s`;
                return <div key={orchestration.contextId} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3.5 dark:border-violet-900/50 dark:bg-violet-950/15">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-bold text-content">{orchestration.contextId}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", complete ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : failed ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300")}>{t(complete ? "a2a.activityCompleted" : partial ? "a2a.orchestrationPartial" : failed ? "a2a.orchestrationFailed" : "a2a.activityInProgress")}</span></div><div className="mt-1 text-[11px] text-content-muted">{t("a2a.orchestrationSummary", { completed: orchestration.completed, failed: orchestration.failed, total: orchestration.total, duration })}</div></div></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">{orchestration.nodes.map((node, index) => <div key={node.taskId} className="rounded-lg border border-outline bg-surface px-3 py-2"><div className="flex items-center gap-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", activityStatusDotClass(node.status))} /><div className="min-w-0"><div className="truncate text-xs font-bold text-content">{node.peerName}</div><div className="mt-0.5 text-[10px] text-content-muted">{t("a2a.orchestrationNode", { index: index + 1 })} · {t(activityStatusLabelKey(node.status))}</div></div></div>{node.failureReason && <div className="mt-2 line-clamp-2 rounded-md bg-rose-50 px-2 py-1 text-[10px] leading-4 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{node.failureReason}</div>}</div>)}</div>
                </div>;
              })}</div>
            </Card>}

            <Card className="p-4 sm:p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div><div className="flex items-center gap-2 font-bold text-content"><History className="h-4 w-4 text-violet-500" />{t("a2a.recentActivity")}</div><p className="mt-1 text-xs text-content-muted">{t("a2a.recentActivityDescription")}</p></div>
                <Button variant="outline" size="sm" onClick={loadActivity} disabled={activityLoading || !view.enabled}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", activityLoading && "animate-spin")} />{t("a2a.refreshActivity")}</Button>
              </div>
              {activityLoading && activities.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-content-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("a2a.loadingActivity")}</div>
              ) : activities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-outline p-6 text-center text-sm text-content-muted">{t("a2a.noActivity")}</div>
              ) : (
                <div className="space-y-2">{activities.map((activity) => {
                  const outbound = activity.direction === "outbound";
                  const timestamp = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.startedAt));
                  const duration = activity.durationMs == null ? t("a2a.durationPending") : activity.durationMs < 1000 ? `${activity.durationMs} ms` : `${(activity.durationMs / 1000).toFixed(1)} s`;
                  return <div key={`${activity.contextId}-${activity.taskId}`} className="rounded-xl border border-outline bg-surface px-3.5 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", outbound ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40")}>{outbound ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}</span>
                        <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className="text-xs font-bold text-content">{t(outbound ? "a2a.outbound" : "a2a.inbound")}</span><span className="text-content-muted">·</span><span className="truncate text-xs font-semibold text-content-secondary">{activity.peerName}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", activityStatusBadgeClass(activity.status))}>{t(activityStatusLabelKey(activity.status))}</span></div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-content-muted"><span>{timestamp}</span><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{duration}</span><span className="font-mono">{activity.contextId}</span></div></div>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-xs leading-5 text-content-secondary"><span className="font-bold text-content-muted">{t("a2a.requestLabel")} </span>{activity.summary}</div>
                    {activity.result && <div className="mt-1.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-xs leading-5 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300"><span className="font-bold">{t("a2a.resultLabel")} </span>{activity.result}</div>}
                    {activity.failureReason && <div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2 text-xs leading-5 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300"><span className="font-bold">{t("a2a.failureLabel")} </span>{activity.failureReason}</div>}
                    {activity.status === "auth_failed" && activity.peerId && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/20"><div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><div className="text-xs font-bold text-amber-900 dark:text-amber-200">{t("a2a.authRecoveryTitle")}</div><p className="mt-1 text-[11px] leading-5 text-amber-800/90 dark:text-amber-300/90">{t("a2a.authRecoveryDescription", { peer: activity.peerName })}</p></div></div><div className="mt-2 flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" onClick={() => onOpenPeer(activity.peerId!)}>{t("a2a.managePeer")}</Button><Button variant="outline" size="sm" onClick={onRedeploy}><RotateCw className="mr-1.5 h-3.5 w-3.5" />{t("a2a.redeployCurrent")}</Button></div></div>}
                    {activity.peerId && isRetryableA2AStatus(activity.status) && <div className="mt-2 flex justify-end"><Button variant="outline" size="sm" onClick={() => onRetryInChat(t("a2a.retryDraft", { peerId: activity.peerId, summary: activity.summary }))}><RotateCw className="mr-1.5 h-3.5 w-3.5" />{t("a2a.retryInChat")}</Button></div>}
                  </div>;
                })}</div>
              )}
            </Card>

            <div className="flex flex-col-reverse justify-between gap-3 sm:flex-row sm:items-center">
              <Button variant="outline" onClick={rotateToken} disabled={!view.hasToken}><RotateCw className="mr-1.5 h-4 w-4" />{t("a2a.rotateToken")}</Button>
              <Button onClick={save} disabled={saving || !agentName.trim()} className="bg-indigo-600 text-white">{saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{t("a2a.save")}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusCard({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return <Card className="p-3.5"><div className="flex items-center gap-2">{ready ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <TriangleAlert className="h-4 w-4 text-amber-500" />}<div><div className="text-[10px] font-bold uppercase tracking-wider text-content-muted">{label}</div><div className="mt-0.5 text-sm font-bold text-content">{value}</div></div></div></Card>;
}

function parseCapabilityText(value: string | undefined): string[] {
  return Array.from(new Set(String(value || "").split(/[,，\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))).slice(0, 8);
}

function activityStatusLabelKey(status: A2AActivityStatus): string {
  return `a2a.activityStatuses.${status}`;
}

function activityStatusDotClass(status: A2AActivityStatus): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "in_progress") return "bg-amber-500 animate-pulse";
  if (status === "cancelled") return "bg-slate-400";
  return "bg-rose-500";
}

function activityStatusBadgeClass(status: A2AActivityStatus): string {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (status === "in_progress") return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  if (status === "cancelled") return "bg-slate-100 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
  return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
}
