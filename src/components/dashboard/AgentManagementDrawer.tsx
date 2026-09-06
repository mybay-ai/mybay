import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Download,
  FolderOpen,
  MessageSquare,
  Pencil,
  RotateCcw,
  Settings2,
  Share2,
  ShieldCheck,
  Stethoscope,
  TerminalSquare,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { supportsRuntimeDashboard } from "../../../shared/runtimeAccessPolicy";
import type { AgentInstance } from "../../types";
import { Button, cn } from "../ui";
import { getAssistantCardPresentation } from "./assistantCardPresentation";
import { getRefinedStatusLabel } from "./instanceStatus";
import { AgentAvatar } from "../agent/AgentAvatar";

type DetailTab = "logs" | "diagnostics" | "collaboration";

interface AgentManagementDrawerProps {
  instance: AgentInstance;
  pending: boolean;
  actioning: boolean;
  onClose: () => void;
  onChat: () => void;
  onFiles: () => void;
  onSettings: () => void;
  onRename?: () => void;
  onOpenDetails: (tab: DetailTab) => void;
  onExport: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onRedeploy: () => void;
}

export function AgentManagementDrawer({
  instance,
  pending,
  actioning,
  onClose,
  onChat,
  onFiles,
  onSettings,
  onRename,
  onOpenDetails,
  onExport,
  onRedeploy,
}: AgentManagementDrawerProps) {
  const { t } = useTranslation("dashboard");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const advancedId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const presentation = getAssistantCardPresentation(instance, pending);
  const status = getRefinedStatusLabel(instance);
  const runtimeType = String(instance.runtime_type || instance.config?.runtime_type || "hermes").toLowerCase();
  const dashboardSupported = supportsRuntimeDashboard(runtimeType);
  const dashboardEnabled = instance.configSummary?.enableDashboard !== false && instance.config?.enableDashboard !== false;
  const passwordProtected = instance.configSummary?.hasPassword === true || instance.configSummary?.authMode === "basic_auth";
  const model = instance.model_name || instance.configSummary?.model || t("agent_management_not_reported");
  const channel = instance.configSummary?.channelLabel
    || instance.configSummary?.configuredChannels?.join(", ")
    || instance.configSummary?.channel
    || t("agent_management_web_channel");
  const purpose = instance.configSummary?.templateName
    || instance.configSummary?.agentPromptPreview
    || t("agent_view_general");
  const accessKey = !dashboardSupported
    ? "agent_management_access_workspace"
    : !dashboardEnabled
      ? "agent_management_access_disabled"
      : passwordProtected
        ? "agent_management_access_protected"
        : /^https?:\/\//i.test(instance.url || "")
          ? "agent_management_access_public"
          : "agent_management_access_unknown";

  useEffect(() => {
    const dialog = dialogRef.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [instance.id]);

  const leave = (action: () => void) => {
    onClose();
    action();
  };
  const issueAction = presentation.issue === "model" ? onSettings : () => onOpenDetails("diagnostics");

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl border-0 border-l border-outline bg-surface p-0 text-content shadow-2xl backdrop:bg-slate-950/55"
    >
      <div className="flex h-full min-h-0 flex-col" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-outline px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <AgentAvatar instance={instance} label={instance.name} className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <h2 id={headingId} className="text-lg font-semibold text-content">{t("agent_management_title")}</h2>
              <p className="truncate text-sm text-content-muted">{instance.name}</p>
            </div>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={t("agent_management_close")}
            className="rounded-lg p-2 text-content-muted transition-colors hover:bg-surface-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
          <section className="rounded-2xl border border-outline bg-surface-muted/35 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-content">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", status.color)} />
              <span>{t(status.i18nKey || status.text, { defaultValue: status.text })}</span>
            </div>
            <dl className="mt-5 grid grid-cols-1 gap-4 text-sm min-[420px]:grid-cols-2">
              <div>
                <dt className="text-xs text-content-muted">{t("agent_management_purpose")}</dt>
                <dd className="mt-1 break-words font-medium text-content">{purpose}</dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">{t("agent_management_runtime")}</dt>
                <dd className="mt-1 break-words font-medium text-content">{runtimeType === "pi" ? "Pi Agent" : "Hermes Agent"}</dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">{t("agent_management_model")}</dt>
                <dd className="mt-1 break-all font-medium text-content">{model}</dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">{t("agent_management_channel")}</dt>
                <dd className="mt-1 break-words font-medium text-content">{channel}</dd>
              </div>
            </dl>
            <div className={cn(
              "mt-5 flex items-start gap-2 border-t border-outline pt-4 text-xs leading-5",
              accessKey === "agent_management_access_public" ? "text-amber-700 dark:text-amber-300" : "text-content-secondary",
            )}>
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(accessKey)}</span>
            </div>
          </section>

          {presentation.needsAttention && presentation.issue && (
            <section className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <h3 className="flex items-start gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t(`agent_view_issue_${presentation.issue}`)}
              </h3>
              <p className="mt-2 text-xs leading-5 text-content-secondary">{t("agent_management_issue_hint")}</p>
              <Button variant="outline" className="mt-3 min-h-10 whitespace-normal" onClick={() => leave(issueAction)}>
                {presentation.issue === "model" ? t("agent_management_settings") : t("agent_management_diagnostics")}
              </Button>
            </section>
          )}

          <section className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-content">{t("agent_management_common_actions")}</h3>
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <Button className="min-h-11 gap-2 whitespace-normal" disabled={!presentation.canChat} onClick={() => leave(onChat)}>
                <MessageSquare className="h-4 w-4 shrink-0" />{t("agent_view_chat")}
              </Button>
              <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" disabled={!presentation.canOpenFiles} onClick={() => leave(onFiles)}>
                <FolderOpen className="h-4 w-4 shrink-0" />{t("agent_view_files")}
              </Button>
              <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" disabled={pending || instance.status === "deleting"} onClick={() => leave(onSettings)}>
                <Settings2 className="h-4 w-4 shrink-0" />{t("agent_management_settings")}
              </Button>
              {onRename && (
                <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" disabled={pending || instance.status === "deleting"} onClick={() => leave(onRename)}>
                  <Pencil className="h-4 w-4 shrink-0" />{t("agent_management_rename")}
                </Button>
              )}
            </div>
          </section>

          <section className="mt-6 border-t border-outline pt-5">
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls={advancedId}
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-outline bg-surface-muted px-4 py-3 text-left text-sm font-semibold text-content transition-colors hover:bg-control-hover"
            >
              {t("agent_management_advanced")}
              <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
            </button>
            <p className="mt-2 text-xs leading-5 text-content-muted">{t("agent_management_advanced_hint")}</p>

            {advancedOpen && (
              <div id={advancedId} className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" onClick={() => leave(() => onOpenDetails("logs"))}>
                  <TerminalSquare className="h-4 w-4 shrink-0" />{t("agent_management_runtime_details")}
                </Button>
                <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" onClick={() => leave(() => onOpenDetails("diagnostics"))}>
                  <Stethoscope className="h-4 w-4 shrink-0" />{t("agent_management_diagnostics")}
                </Button>
                <Button variant="outline" className="min-h-11 gap-2 whitespace-normal" onClick={() => leave(() => onOpenDetails("collaboration"))}>
                  <Share2 className="h-4 w-4 shrink-0" />{t("agent_management_collaboration")}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 gap-2 whitespace-normal"
                  disabled={instance.archived || pending || actioning}
                  onClick={onExport}
                  title={t("action_export_archive_tooltip")}
                >
                  <Download className="h-4 w-4 shrink-0" />{t("action_export_archive_short")}
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11 gap-2 whitespace-normal text-amber-700 dark:text-amber-300"
                  disabled={instance.archived || pending || actioning}
                  onClick={() => leave(onRedeploy)}
                >
                  <RotateCcw className={cn("h-4 w-4 shrink-0", actioning && "animate-spin")} />{t("btn_redeploy")}
                </Button>
              </div>
            )}
          </section>

          <div className="mt-6 flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-2.5 text-xs text-content-muted">
            <Bot className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate" title={instance.id}>{t("agent_management_instance_id")}: {instance.id}</span>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
