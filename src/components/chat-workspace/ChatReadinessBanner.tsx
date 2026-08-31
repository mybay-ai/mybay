import { Trans, useTranslation } from "react-i18next";
import { AlertCircle } from "lucide-react";
import type { AgentInstance } from "../../types";
import { getChatErrorMessage } from "../../lib/chatRuntimeErrors";
import { InstanceReadinessNotice } from "../instance-runtime/InstanceReadinessNotice";
import type { InstanceChatReadinessProbe } from "../../hooks/useLocalInstanceReadiness";

type ReadinessState = InstanceChatReadinessProbe;

type ChatReadinessBannerProps = {
  selectedId: string;
  isChatReady: boolean;
  selectedInstance?: AgentInstance;
  selectedReadiness?: ReadinessState;
  onReadinessChecked?: (probe: InstanceChatReadinessProbe) => void;
  onOpenDiagnostics?: () => void;
};

export function ChatReadinessBanner({
  selectedId,
  isChatReady,
  selectedInstance,
  selectedReadiness,
  onReadinessChecked,
  onOpenDiagnostics,
}: ChatReadinessBannerProps) {
  const { t } = useTranslation(["dashboard", "common"]);

  if (!selectedId || isChatReady) {
    return null;
  }

  const channel = selectedInstance?.configSummary?.channel || "web";
  const isPureWeb = channel === "web" || channel === "none";
  const readinessMessage = getChatErrorMessage({ code: selectedReadiness?.reason, message: selectedReadiness?.message }, selectedReadiness?.message || t("dashboard:chatWorkspace.statusNotReady"));
  return (
    <div className="mb-4 mx-auto max-w-2xl space-y-3">
      <InstanceReadinessNotice instance={{ ...selectedInstance, id: selectedId } as AgentInstance} chatReadiness={selectedReadiness || null} onProbe={onReadinessChecked} onOpenDiagnostics={onOpenDiagnostics} />
      {!isPureWeb && (
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
      )}
    </div>
  );
}
