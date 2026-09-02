import React from "react";
import { Loader2, Terminal } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { useTranslation } from "react-i18next";
import { normalizeAgentUpgradePhase } from "../../../shared/agentUpgradePhase";
import { getAuditActionLabel } from "./versionStatusPresentation";

interface VersionLogsModalProps {
  showLogsModal: boolean;
  logsInstanceId: string | null;
  logs: any[];
  loadingLogs: boolean;
  onClose: () => void;
  onRefreshLogs: () => void;
}

export function VersionLogsModal({
  showLogsModal,
  logsInstanceId,
  logs,
  loadingLogs,
  onClose,
  onRefreshLogs
}: VersionLogsModalProps) {
  const { t, i18n } = useTranslation("dashboard");
  if (!showLogsModal) return null;

  return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-3xl bg-slate-950 border border-slate-800 text-slate-100 rounded-2xl shadow-xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900 text-white">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-sm truncate">{t("versionManagement.logs.title", { instanceId: logsInstanceId })}</span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title={t("versionManagement.logs.close")}
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0c1017] font-mono text-[13px] md:text-sm space-y-3 scrollbar-thin select-text min-h-[300px]">
              {loadingLogs ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500 mb-2" />
                  <span>{t("versionManagement.logs.loading")}</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="text-slate-500 text-center py-20">
                  <span>{t("versionManagement.logs.empty")}</span>
                </div>
              ) : (
                <div className="space-y-1.5 leading-relaxed text-left">
                  {logs.map((log: any) => {
                    const phase = normalizeAgentUpgradePhase(log.phase, null);
                    return (
                    <div key={log.id} className="border-b border-slate-900/40 pb-2 last:border-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-slate-500 font-bold shrink-0">
                          [{new Date(log.timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language, { hour12: false })}]
                        </span>
                        <span className={cn(
                          "px-1.5 py-0.2 rounded text-[11px] font-bold tracking-tight shrink-0 uppercase",
                          log.action?.includes("failed") || log.action?.includes("error") ? "bg-red-950 text-red-400" :
                          log.action?.includes("success") ? "bg-green-950 text-green-400" : "bg-blue-950/60 text-blue-400"
                        )}>
                          {getAuditActionLabel(t, log.action)}
                        </span>
                        {phase !== "idle" && (
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-300 shrink-0">
                            {t(`versionManagement.phases.${phase}`)}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 pl-4 whitespace-pre-wrap">{log.details}</p>
                    </div>
                  )})}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-800 shrink-0 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="text-[11px] text-slate-500">{t("versionManagement.logs.rawDetailsHint")}</span>
              <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onRefreshLogs}
                className="bg-slate-800 hover:bg-slate-700 border-slate-750 text-white font-bold rounded-lg py-1 px-3"
              >
                {t("versionManagement.logs.refresh")}
              </Button>
              <Button
                onClick={onClose}
                className="bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-lg py-1 px-3"
              >
                {t("versionManagement.logs.close")}
              </Button>
              </div>
            </div>
          </Card>
        </div>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
