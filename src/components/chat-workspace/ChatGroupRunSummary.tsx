import { CheckCircle2, ChevronDown, Clock3, ExternalLink, RefreshCw, RotateCw, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { readChatGroupRun, type ChatGroupRun } from "../../../shared/chatCollaboration";
import { buildA2ATaskRecordUrl } from "../../constants/routes";
import { api } from "../../lib/api";
import { canReviewA2ARecovery } from "./a2aRetryNavigation";

export type GroupRunActivity = {
  contextId: string;
  taskId: string;
  peerId: string | null;
  peerName: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  requestText?: string | null;
  summary?: string | null;
  result?: string | null;
  failureReason?: string | null;
};

const TERMINAL_ACTIVITY_STATUSES = new Set(["completed", "failed", "timed_out", "agent_offline", "auth_failed", "connection_failed", "cancelled"]);
const MAX_AUTO_REFRESH_ATTEMPTS = 60;

function indexLatestActivityByPeer(activities: GroupRunActivity[]) {
  const byPeer = new Map<string | null, GroupRunActivity>();
  for (const activity of activities) {
    if (!byPeer.has(activity.peerId)) byPeer.set(activity.peerId, activity);
  }
  return byPeer;
}

export function shouldPollGroupActivities(group: ChatGroupRun, activities: GroupRunActivity[]) {
  const byPeer = indexLatestActivityByPeer(activities);
  return group.peers.some(peer => {
    const activity = byPeer.get(peer.id);
    return !activity || !TERMINAL_ACTIVITY_STATUSES.has(activity.status);
  });
}

export function formatGroupDuration(durationMs: number | null | undefined, language: string, pending: string) {
  if (durationMs == null) return pending;
  const zh = language.toLowerCase().startsWith("zh");
  if (durationMs < 1000) return zh ? `${durationMs}毫秒` : `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(seconds < 10 ? 1 : 0))}${zh ? "秒" : "s"}`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Number(minutes.toFixed(minutes < 10 ? 1 : 0))}${zh ? "分钟" : "m"}`;
  const hours = minutes / 60;
  return `${Number(hours.toFixed(hours < 10 ? 1 : 0))}${zh ? "小时" : "h"}`;
}

export function ChatGroupRunSummary({ instanceId, value, onPrepareRecovery }: { instanceId?: string; value: unknown; onPrepareRecovery?: (activity: GroupRunActivity) => void }) {
  const { t, i18n } = useTranslation("dashboard");
  const group = useMemo(() => readChatGroupRun(value), [value]);
  const [activities, setActivities] = useState<GroupRunActivity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    setActivities([]);
    setLoadFailed(false);
    if (!instanceId || !group) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const load = async () => {
      attempts += 1;
      setRefreshing(true);
      try {
        const response = await api.get<{ activities?: GroupRunActivity[] }>(`/api/instances/${encodeURIComponent(instanceId)}/a2a/activity?limit=100`, { signal: controller.signal });
        const matching = (response.activities || []).filter(activity => activity.contextId === group.contextId);
        setActivities(matching);
        setLoadFailed(false);
        if (attempts < MAX_AUTO_REFRESH_ATTEMPTS && shouldPollGroupActivities(group, matching)) timer = setTimeout(load, 3000);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadFailed(true);
          if (attempts < MAX_AUTO_REFRESH_ATTEMPTS) timer = setTimeout(load, 3000);
        }
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    };

    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [group, instanceId]);

  if (!group) return null;
  const byPeer = indexLatestActivityByPeer(activities);
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/55 dark:border-violet-400/25 dark:bg-violet-500/10">
      <div className="flex items-center justify-between gap-2 border-b border-violet-200/70 px-3 py-2 text-xs font-semibold text-violet-700 dark:border-violet-400/20 dark:text-violet-200">
        <span className="flex min-w-0 items-center gap-2"><Users className="h-3.5 w-3.5 shrink-0" />{t("chatWorkspace.groupRunTitle", { count: group.peers.length + 1 })}</span>
        {refreshing && <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label={t("chatWorkspace.groupRunRefreshing")} />}
      </div>
      {loadFailed && <div className="border-b border-amber-200/70 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-400/20 dark:text-amber-300">{t("chatWorkspace.groupRunLoadFailed")}</div>}
      <div className="grid gap-1.5 p-2 sm:grid-cols-2">
        {group.peers.map(peer => {
          const activity = byPeer.get(peer.id);
          const completed = activity?.status === "completed";
          const failed = Boolean(activity && TERMINAL_ACTIVITY_STATUSES.has(activity.status) && !completed);
          const canPrepareRecovery = Boolean(activity && onPrepareRecovery && canReviewA2ARecovery({ direction: "outbound", peerId: activity.peerId, status: activity.status }));
          const StatusIcon = completed ? CheckCircle2 : failed ? XCircle : Clock3;
          const duration = formatGroupDuration(activity?.durationMs, i18n.language, t("chatWorkspace.groupRunDurationPending"));
          return (
            <div key={peer.id} className="min-w-0 rounded-lg border border-violet-100 bg-surface/80 px-2.5 py-2 dark:border-violet-400/15">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-content">
                <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${completed ? "text-emerald-500" : failed ? "text-rose-500" : "text-amber-500"}`} />
                <span className="min-w-0 flex-1 truncate">{peer.name}</span>
                {activity && <span className="shrink-0 text-[10px] font-normal text-content-muted">{t(`a2a.activityStatuses.${activity.status}`, { defaultValue: activity.status })} · {duration}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-content-muted">{activity?.result || activity?.failureReason || t(activity ? "chatWorkspace.groupRunNoResult" : "chatWorkspace.groupRunNoActivity")}</p>
              {activity && (
                <details className="group mt-1.5 border-t border-outline/60 pt-1.5 text-[11px] text-content-muted">
                  <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-content-secondary hover:text-content">
                    <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />{t("chatWorkspace.groupRunDetails")}
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    <div><span className="font-semibold text-content-secondary">{t("chatWorkspace.groupRunTaskId")}: </span><span className="break-all font-mono">{activity.taskId}</span></div>
                    <div><span className="font-semibold text-content-secondary">{t("chatWorkspace.groupRunContextId")}: </span><span className="break-all font-mono">{activity.contextId}</span></div>
                    <div><span className="font-semibold text-content-secondary">{t("chatWorkspace.groupRunDuration")}: </span>{duration}</div>
                    {(activity.result || activity.failureReason) && <div className={`rounded-md px-2 py-1.5 leading-4 ${activity.failureReason ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "bg-surface-muted text-content-secondary"}`}>{activity.failureReason || activity.result}</div>}
                    {canPrepareRecovery && <p className="text-amber-700 dark:text-amber-300">{t("chatWorkspace.groupRunRecoveryHint")}</p>}
                    <div className="flex flex-wrap items-center gap-2">
                      <a className="inline-flex items-center gap-1 font-semibold text-violet-700 hover:underline dark:text-violet-300" href={buildA2ATaskRecordUrl(instanceId, activity.taskId)}>{t("chatWorkspace.groupRunOpenRecord")}<ExternalLink className="h-3 w-3" /></a>
                      {canPrepareRecovery && <button type="button" className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50" onClick={() => onPrepareRecovery?.(activity)}><RotateCw className="h-3 w-3" />{t("a2a.reviewRecovery")}</button>}
                    </div>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
