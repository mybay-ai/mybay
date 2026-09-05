import { CheckCircle2, Clock3, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { readChatGroupRun, type ChatGroupRun } from "../../../shared/chatCollaboration";
import { api } from "../../lib/api";

type Activity = { contextId: string; peerId: string | null; peerName: string; status: string; result?: string | null; failureReason?: string | null };

export function ChatGroupRunSummary({ instanceId, value }: { instanceId?: string; value: unknown }) {
  const { t } = useTranslation("dashboard");
  const group = useMemo(() => readChatGroupRun(value), [value]);
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    setActivities([]);
    if (!instanceId || !group) return;
    const controller = new AbortController();
    void api.get<{ activities?: Activity[] }>(`/api/instances/${encodeURIComponent(instanceId)}/a2a/activity?limit=50`, { signal: controller.signal })
      .then(response => setActivities((response.activities || []).filter(activity => activity.contextId === group.contextId)))
      .catch(error => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setActivities([]);
      });
    return () => controller.abort();
  }, [group, instanceId]);

  if (!group) return null;
  const byPeer = new Map(activities.map(activity => [activity.peerId, activity]));
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/55 dark:border-violet-400/25 dark:bg-violet-500/10">
      <div className="flex items-center gap-2 border-b border-violet-200/70 px-3 py-2 text-xs font-semibold text-violet-700 dark:border-violet-400/20 dark:text-violet-200">
        <Users className="h-3.5 w-3.5" />
        {t("chatWorkspace.groupRunTitle", { count: group.peers.length + 1 })}
      </div>
      <div className="grid gap-1.5 p-2 sm:grid-cols-2">
        {group.peers.map(peer => {
          const activity = byPeer.get(peer.id);
          const completed = activity?.status === "completed";
          const failed = activity && ["failed", "timed_out", "agent_offline", "auth_failed", "connection_failed", "cancelled"].includes(activity.status);
          const StatusIcon = completed ? CheckCircle2 : failed ? XCircle : Clock3;
          return (
            <div key={peer.id} className="rounded-lg border border-violet-100 bg-surface/80 px-2.5 py-2 dark:border-violet-400/15">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-content"><StatusIcon className={`h-3.5 w-3.5 ${completed ? "text-emerald-500" : failed ? "text-rose-500" : "text-amber-500"}`} /><span className="truncate">{peer.name}</span></div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-content-muted">{activity?.result || activity?.failureReason || t(activity ? "chatWorkspace.groupRunNoResult" : "chatWorkspace.groupRunNoActivity")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
