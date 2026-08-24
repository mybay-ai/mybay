import { Trans, useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import type { AgentInstance } from "../../types";
import { getChatErrorMessage } from "../../lib/chatRuntimeErrors";
import { deriveLocalInstanceReadiness } from "../../../shared/localInstanceReadiness";

type ReadinessState = {
  ready: boolean;
  runtimeReady?: boolean;
  reason?: string;
  message?: string;
};

type ChatReadinessBannerProps = {
  selectedId: string;
  isChatReady: boolean;
  selectedInstance?: AgentInstance;
  selectedReadiness?: ReadinessState;
};

export function ChatReadinessBanner({
  selectedId,
  isChatReady,
  selectedInstance,
  selectedReadiness
}: ChatReadinessBannerProps) {
  const { t } = useTranslation(["dashboard", "common"]);

  if (!selectedId || isChatReady) {
    return null;
  }

  const channel = selectedInstance?.configSummary?.channel || "web";
  const isPureWeb = channel === "web" || channel === "none";
  const readinessMessage = getChatErrorMessage({ code: selectedReadiness?.reason, message: selectedReadiness?.message }, selectedReadiness?.message || t("dashboard:chatWorkspace.statusNotReady"));
  const unifiedReadiness = deriveLocalInstanceReadiness({
    status: selectedInstance?.status,
    physicalStatus: selectedInstance?.physical_status,
    deploymentError: selectedInstance?.deployment_error,
    modelConfigStatus: selectedInstance?.model_config_status,
    gatewayStatus: selectedInstance?.gateway_status,
    configuredChannels: selectedInstance?.configured_channels,
    connectedChannels: selectedInstance?.connected_channels,
    chat: selectedReadiness,
  });

  if (isPureWeb) {
    return (
      <div className="mb-4 mx-auto max-w-2xl bg-amber-50 border border-amber-200/60 text-amber-800 rounded-xl p-4 text-[13px] flex items-start gap-3 shadow-sm animate-fade-in duration-200 dark:bg-amber-950/30 dark:border-amber-500/30 dark:text-amber-200">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1 text-left">
          <p className="font-bold text-amber-900 dark:text-amber-100">
            {t(`dashboard:readiness_${unifiedReadiness.phase}_title`)}
          </p>
          <p className="text-amber-700 leading-relaxed dark:text-amber-200/90">
            {readinessMessage || t("dashboard:chatWorkspace.webOnlyDeployPendingDesc")}
            {" "}
            ({t("dashboard:chatWorkspace.errorCodeLabel")}: <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-[11px] text-amber-800 font-semibold">{selectedReadiness?.reason || "UNKNOWN"}</code>)
          </p>
          <p className="text-content-muted text-[13px] leading-relaxed mt-1">
            {unifiedReadiness.runtimeReady
              ? t("dashboard:chatWorkspace.runtimeReadyChatPendingTip")
              : t("dashboard:chatWorkspace.webOnlyDeployPendingTip")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 mx-auto max-w-2xl bg-blue-50 border border-blue-200/60 text-blue-800 rounded-xl p-4 text-[13px] flex items-start gap-3 shadow-sm animate-fade-in duration-200 dark:bg-blue-950/30 dark:border-blue-500/30 dark:text-blue-200">
      <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
      <div className="space-y-1 text-left">
        <p className="font-bold text-blue-900 dark:text-blue-100">{t("dashboard:chatWorkspace.externalChannelTitle")}</p>
        <p className="text-content-secondary leading-relaxed">
          <Trans
            i18nKey="dashboard:chatWorkspace.externalChannelDesc"
            values={{ channel: selectedInstance?.configSummary?.channelLabel || selectedInstance?.configSummary?.channel || t("dashboard:chatWorkspace.externalChannelFallback") }}
            components={{ strong: <strong /> }}
          />
        </p>
        <p className="text-blue-700 leading-relaxed text-[13px] mt-1.5 border-t border-blue-100 pt-1.5 dark:text-blue-200/90 dark:border-blue-500/20">
          <Trans
            i18nKey="dashboard:chatWorkspace.externalChannelTip"
            values={{ reason: readinessMessage || t("dashboard:chatWorkspace.portNotReadyFallback") }}
            components={{ strong: <strong /> }}
          />
        </p>
      </div>
    </div>
  );
}
