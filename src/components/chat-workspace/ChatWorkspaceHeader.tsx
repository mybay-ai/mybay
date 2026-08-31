import { useTranslation } from "react-i18next";
import { HelpCircle, Menu, Play, Sliders, Sparkles, Trash2, Zap } from "lucide-react";
import type { AgentInstance } from "../../types";

type ReadinessState = { ready: boolean; reason?: string; message?: string };

type GroupedInstances = {
  ready: AgentInstance[];
  probing: AgentInstance[];
  unready: AgentInstance[];
};

type ChatWorkspaceHeaderProps = {
  mobileSidebarOpen: boolean;
  loadingInstances: boolean;
  instances: AgentInstance[];
  selectedId: string;
  selectedInstance?: AgentInstance;
  groupedInstances: GroupedInstances;
  chatReadiness: Record<string, ReadinessState>;
  showSettings: boolean;
  hasMessages: boolean;
  chatMode: "quick" | "assist" | "agent";
  getInstanceDropdownLabel: (instance: AgentInstance) => string;
  onOpenMobileSidebar: () => void;
  onDeployNewInstance: () => void;
  onInstanceChange: (instanceId: string) => void;
  onToggleSettings: () => void;
  onClear: () => void;
};

export function ChatWorkspaceHeader({
  mobileSidebarOpen,
  loadingInstances,
  instances,
  selectedId,
  selectedInstance,
  groupedInstances,
  chatReadiness,
  showSettings,
  hasMessages,
  chatMode,
  getInstanceDropdownLabel,
  onOpenMobileSidebar,
  onDeployNewInstance,
  onInstanceChange,
  onToggleSettings,
  onClear
}: ChatWorkspaceHeaderProps) {
  const { t } = useTranslation(["dashboard", "common"]);
  const modeMeta = {
    quick: { label: t("dashboard:chatWorkspace.modeQuick"), icon: Zap, className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-400/25" },
    assist: { label: "Assist", icon: HelpCircle, className: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-400/25" },
    agent: { label: t("dashboard:chatWorkspace.modeAgent"), icon: Sparkles, className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/25" }
  }[chatMode];
  const ModeIcon = modeMeta.icon;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-outline/80 px-3.5 sm:px-4 py-2.5 gap-3 bg-surface/90 backdrop-blur shrink-0 select-none">
      <div className="flex items-center gap-3 min-w-0 flex-1 sm:flex-initial">
        <button
          onClick={onOpenMobileSidebar}
          className="p-1.5 hover:bg-slate-150 text-content-muted rounded-lg shrink-0 md:hidden block mr-1 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          title={t("dashboard:chatWorkspace.sidebarToggle")}
          aria-expanded={mobileSidebarOpen}
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-content tracking-tight flex items-center gap-2">
            <span className="truncate">{t("dashboard:chatWorkspace.title")}</span>
          </h1>
          <p className="text-[13px] text-content-muted mt-0.5 truncate">
            {t("dashboard:chatWorkspace.multiturnDesc")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:justify-end shrink-0 min-w-0">
        <span className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold whitespace-nowrap ${modeMeta.className}`}>
          <ModeIcon className="h-3.5 w-3.5" />
          {modeMeta.label}
        </span>

        <div className="relative flex-1 sm:flex-none min-w-[150px] sm:min-w-[180px] md:min-w-[220px] max-w-full sm:max-w-[260px] shrink-0">
          {loadingInstances ? (
            <div className="h-9 px-3 border border-outline rounded-lg flex items-center justify-center bg-surface text-content-muted text-[13px] gap-1.5 w-full animate-pulse shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-ping shrink-0" />
              <span className="truncate">{t("dashboard:chatWorkspace.loadingInstances")}</span>
            </div>
          ) : instances.length === 0 ? (
            <button
              type="button"
              onClick={onDeployNewInstance}
              className="h-9 px-3.5 bg-surface-muted hover:bg-surface-muted border border-outline text-content-secondary text-[13px] font-medium rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors w-full shrink-0 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">{t("dashboard:chatWorkspace.deployNewInstance")}</span>
            </button>
          ) : (
            <select
              value={selectedId}
              onChange={(event) => onInstanceChange(event.target.value)}
              className="h-9 pl-3.5 pr-8 bg-surface hover:bg-surface-muted border border-outline rounded-lg text-[13px] font-semibold text-content transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500/55 w-full cursor-pointer appearance-none shadow-xs truncate shrink-0"
            >
              {groupedInstances.ready.length > 0 && (
                <optgroup label={t("dashboard:chatWorkspace.activeInstances")}>
                  {groupedInstances.ready.map((inst) => (
                    <option key={inst.id} value={inst.id}>{getInstanceDropdownLabel(inst)}</option>
                  ))}
                </optgroup>
              )}
              {groupedInstances.probing.length > 0 && (
                <optgroup label={t("dashboard:chatWorkspace.probingInstances")}>
                  {groupedInstances.probing.map((inst) => (
                    <option key={inst.id} value={inst.id}>{getInstanceDropdownLabel(inst)}</option>
                  ))}
                </optgroup>
              )}
              {groupedInstances.unready.length > 0 && (
                <optgroup label={t("dashboard:chatWorkspace.externalChannelInstances")}>
                  {groupedInstances.unready.map((inst) => (
                    <option key={inst.id} value={inst.id}>{getInstanceDropdownLabel(inst)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          {!loadingInstances && instances.length > 0 && (
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-content-muted">
              <Sliders className="w-3 h-3 rotate-90 shrink-0" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedInstance && !loadingInstances && (() => {
            const readiness = chatReadiness[selectedId];
            const channel = selectedInstance.configSummary?.channel || "web";
            const isPureWeb = channel === "web" || channel === "none";

            if (!readiness) {
              return (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-[13px] font-medium bg-slate-100 text-slate-600 border border-slate-200 select-none shrink-0 whitespace-nowrap">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-ping mr-1.5 shrink-0" />
                  {t("dashboard:chatWorkspace.statusProbing")}
                </span>
              );
            }
            if (readiness.ready) {
              return (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-[13px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-250 select-none shrink-0 animate-fade-in duration-200 whitespace-nowrap">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 shrink-0" />
                  {t("dashboard:chatWorkspace.statusActive")}
                </span>
              );
            }
            if (isPureWeb) {
              return (
                <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-[13px] font-medium bg-amber-50 text-amber-700 border border-amber-200 select-none shrink-0 animate-fade-in duration-200 whitespace-nowrap" title={t("dashboard:chatWorkspace.statusNotReady")}>
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 shrink-0" />
                  <span className="hidden md:inline">{t("dashboard:chatWorkspace.statusWorkbench")}</span>{t("dashboard:chatWorkspace.statusNotReady")}
                </span>
              );
            }
            return (
              <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-[13px] font-medium bg-blue-50 text-blue-700 border border-blue-200 select-none shrink-0 animate-fade-in duration-200 whitespace-nowrap" title={t("dashboard:chatWorkspace.statusExternalMode")}>
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 shrink-0" />
                <span className="hidden md:inline">{t("dashboard:chatWorkspace.statusExternal")}</span>{t("dashboard:chatWorkspace.statusMode")}
              </span>
            );
          })()}

          {selectedId && (
            <button
              type="button"
              onClick={onToggleSettings}
              className={`h-9 px-3 border rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium transition-all shrink-0 whitespace-nowrap ${
                showSettings
                  ? "bg-surface-muted border-outline-strong text-content shadow-inner"
                  : "bg-surface hover:bg-surface-muted border-outline text-content-secondary"
              }`}
              title={t("dashboard:chatWorkspace.paramSettings")}
            >
              <Sliders className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">{t("dashboard:chatWorkspace.paramSettings")}</span>
            </button>
          )}

          {hasMessages && (
            <button
              type="button"
              onClick={onClear}
              className="h-9 px-3 bg-surface hover:bg-red-50 border border-outline hover:border-red-200 text-slate-500 hover:text-red-600 rounded-lg inline-flex items-center justify-center gap-1.5 text-[13px] font-medium transition-all shadow-xs shrink-0 whitespace-nowrap dark:hover:bg-red-950/40 dark:hover:border-red-500/50 dark:text-slate-300 dark:hover:text-red-300"
              title={t("dashboard:chatWorkspace.clearChatTooltip")}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden md:inline">{t("dashboard:chatWorkspace.clearChat")}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
