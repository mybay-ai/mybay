import React from "react";
import { AlertTriangle, ArrowRight, FolderOpen, MessageSquare, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { APP_ROUTES } from "../../constants/routes";
import { Button, cn } from "../ui";
import { InstanceGrid } from "./InstanceGrid";
import { getRefinedStatusLabel } from "./instanceStatus";
import { getAssistantCardPresentation } from "./assistantCardPresentation";
import { AgentManagementDrawer } from "./AgentManagementDrawer";
import { AgentAvatar } from "../agent/AgentAvatar";

type Props = React.ComponentProps<typeof InstanceGrid> & { bulkMode: boolean };

export function AssistantInstanceGrid(props: Props) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [managedInstanceId, setManagedInstanceId] = React.useState<string | null>(null);
  const managedInstance = props.instances.find((instance) => instance.id === managedInstanceId) || null;

  const openDetails = (instanceId: string, tab: "logs" | "diagnostics" | "collaboration" = "logs") => {
    props.setActiveLogs(instanceId);
    props.setDetailTab(tab);
  };

  return (
    <>
      <p className="mb-4 text-sm leading-6 text-content-muted">{t("agent_view_intro")}</p>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, max(260px, calc((100% - 3rem) / 4))), 1fr))" }}>
        {props.instances.map((instance) => {
          const pending = props.deletingIds.has(instance.id);
          const presentation = getAssistantCardPresentation(instance, pending);
          const status = getRefinedStatusLabel(instance);
          const subtitle = instance.configSummary?.templateName
            || instance.configSummary?.agentPromptPreview
            || t("agent_view_general");
          const hintKey = instance.archived
            ? "agent_view_archived_hint"
            : instance.status === "stopped"
              ? "agent_view_stopped_hint"
              : presentation.canChat
                ? "agent_view_chat_hint"
                : "agent_view_unavailable_hint";

          return (
            <article
              key={instance.id}
              aria-label={instance.name}
              className="flex min-h-[224px] min-w-0 flex-col rounded-2xl border border-outline/60 bg-surface p-5 shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-outline-strong hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                {props.bulkMode && (
                  <input
                    type="checkbox"
                    className="mt-3 h-4 w-4 shrink-0 rounded border-outline-strong accent-indigo-600"
                    aria-label={t("agent_view_select", { name: instance.name })}
                    checked={props.selectedInstanceIds.has(instance.id)}
                    disabled={pending}
                    onChange={(event) => props.onSelectInstance(instance.id, event.target.checked)}
                  />
                )}
                <AgentAvatar instance={instance} label={instance.name} />
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 break-words text-base font-semibold leading-6 text-content" title={instance.name}>
                    {instance.name}
                  </h3>
                  <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-content-muted" title={subtitle}>
                    {subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30"
                  aria-label={t("agent_view_manage_named", { name: instance.name })}
                  title={t("action_manage")}
                  onClick={() => setManagedInstanceId(instance.id)}
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 flex items-center gap-2 text-sm text-content-secondary">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", status.color)} />
                <span>{t(status.i18nKey || status.text, { defaultValue: status.text })}</span>
              </div>
              <p className="mt-2 min-h-10 text-xs leading-5 text-content-muted">{t(hintKey)}</p>

              {presentation.needsAttention && (
                <button
                  type="button"
                  onClick={() => openDetails(instance.id, "diagnostics")}
                  className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs leading-5 text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t(`agent_view_issue_${presentation.issue}`)}</span>
                  <ArrowRight className="ml-auto mt-0.5 h-4 w-4 shrink-0" />
                </button>
              )}

              <div className="mt-auto grid grid-cols-1 gap-2 pt-4">
                <Button
                  disabled={!presentation.canChat}
                  onClick={() => navigate(`${APP_ROUTES.CHAT_WORKSPACE}?instanceId=${encodeURIComponent(instance.id)}`)}
                  className="min-h-11 min-w-0 gap-2 rounded-xl"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="whitespace-normal">{t("agent_view_chat")}</span>
                </Button>
                <Button
                  variant="outline"
                  disabled={!presentation.canOpenFiles}
                  onClick={() => props.handleOpenTerminalView(instance.id, "files")}
                  className="min-h-11 min-w-0 gap-2 rounded-xl px-3"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="whitespace-normal">{t("agent_view_files")}</span>
                </Button>

              </div>
            </article>
          );
        })}
      </div>
      {managedInstance && (
        <AgentManagementDrawer
          instance={managedInstance}
          pending={props.deletingIds.has(managedInstance.id)}
          actioning={props.actioningIds.has(managedInstance.id)}
          onClose={() => setManagedInstanceId(null)}
          onChat={() => navigate(`${APP_ROUTES.CHAT_WORKSPACE}?instanceId=${encodeURIComponent(managedInstance.id)}`)}
          onFiles={() => props.handleOpenTerminalView(managedInstance.id, "files")}
          onSettings={() => props.setEditingInstance(managedInstance)}
          onRename={props.onRenameInstance ? () => props.onRenameInstance?.(managedInstance) : undefined}
          onOpenDetails={(tab) => openDetails(managedInstance.id, tab)}
          onExport={(event) => props.handleExportConfig(event, managedInstance.id, managedInstance.name)}
          onRedeploy={() => props.handleInstanceAction(managedInstance.id, "redeploy", true, t("confirm_redeploy"))}
        />
      )}
    </>
  );
}
