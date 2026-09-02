import React from "react";
import { User, Box, AlertCircle, Play, Globe, MoreHorizontal } from "lucide-react";
import { AgentInstance, User as UserType } from "../../types";
import { Button, cn } from "../ui";
import { ContainerStats } from "../ContainerStats";
import { getRefinedStatusLabel } from "./instanceStatus";
import { getInstanceCapabilities } from "./instanceCapabilities";
import { useTranslation } from "react-i18next";

interface InstanceTableProps {
  instances: AgentInstance[];
  viewMode: 'grid' | 'table';
  activeLogs: string | null;
  setActiveLogs: (id: string | null) => void;
  setDetailTab: (tab: 'logs' | 'files' | 'context' | 'diagnostics' | 'collaboration') => void;
  currentUser: UserType;
  handleExportConfig: (e: React.MouseEvent, id: string, name: string) => void;
  handleDelete: (id: string, e?: React.MouseEvent) => void;
  handleArchive: (id: string, e?: React.MouseEvent) => void;
  handleRestore: (id: string, e?: React.MouseEvent) => void;
  handleInstanceAction: (id: string, action: string, requireConfirm?: boolean, confirmMsg?: string) => void;
  handleOpenLink: (e: React.MouseEvent, inst: AgentInstance) => void;
  fetchInstances: () => void;
  setEditingInstance: (inst: AgentInstance) => void;
  onRenameInstance?: (inst: AgentInstance) => void;
  onViewGuide?: (guideId: string) => void;
  handleOpenTerminalView: (instId: string, tab: 'logs' | 'files' | 'context') => void;
  selectedInstanceIds: Set<string>;
  onSelectInstance: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  allSelected: boolean;
  deletingIds: Set<string>;
  actioningIds: Set<string>;
  isMobile?: boolean;
}

export const InstanceTable = React.memo(function InstanceTable({
  instances,
  viewMode,
  activeLogs,
  setActiveLogs,
  setDetailTab,
  currentUser,
  handleExportConfig,
  handleDelete,
  handleArchive,
  handleRestore,
  handleInstanceAction,
  handleOpenLink,
  fetchInstances,
  setEditingInstance,
  onRenameInstance,
  onViewGuide,
  handleOpenTerminalView,
  selectedInstanceIds,
  onSelectInstance,
  onSelectAll,
  allSelected,
  deletingIds,
  actioningIds,
  isMobile = false
}: InstanceTableProps) {
  const { t } = useTranslation("dashboard");

  const openInstanceDetail = (instId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveLogs(instId);
    setDetailTab('logs');
  };

  return (
    <div className={cn(
      "hidden bg-surface rounded-xl border border-outline/50 shadow-xs overflow-hidden",
      viewMode === 'table' ? "xl:block" : "xl:hidden"
    )}>
      <div className="overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full table-fixed text-left text-[12px] border-collapse">
          <colgroup>
            <col className="w-[52px]" />
            <col className="w-[34%]" />
            <col className="w-[120px]" />
            <col className="w-[22%]" />
            <col className="w-[280px]" />
          </colgroup>
          <thead className="bg-surface-muted border-b border-outline/50 text-content-secondary font-semibold text-[13px] tracking-wider uppercase">
            <tr>
              <th className="px-4 py-2.5">
                <input
                  type="checkbox"
                  className="rounded border-outline-strong text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                  checked={allSelected && instances.length > 0}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("th_name")}</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("th_status")}</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">{t("th_url")}</th>
              <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{t("th_actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline/40">
            {instances.map((inst) => {
              const isExpanded = activeLogs === inst.id;
              const caps = getInstanceCapabilities(inst);
              return (
                <React.Fragment key={inst.id}>
                  <tr className={cn("hover:bg-surface-muted/40 transition-colors", isExpanded && "bg-surface-muted/80 hover:bg-surface-muted")}>
                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-outline-strong text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        checked={selectedInstanceIds.has(inst.id)}
                        disabled={deletingIds.has(inst.id)}
                        onChange={(e) => onSelectInstance(inst.id, e.target.checked)}
                      />
                    </td>
                    <td className="min-w-0 px-4 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${inst.archived ? 'bg-indigo-500' : inst.status === 'running' ? 'bg-emerald-500' : inst.status === 'partial_running' ? 'bg-amber-500' : inst.status === 'deploying' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
                        <div className="min-w-0">
                           <div
                             className="truncate font-semibold text-[12px] text-content tracking-tight cursor-pointer hover:text-blue-600 active:text-blue-700 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 no-underline transition-colors"
                             title={t("instance_detail_tooltip") || "点击查看实例详情"}
                             aria-label={t("instance_detail_tooltip") || "点击查看实例详情"}
                             onClick={(e) => openInstanceDetail(inst.id, e)}
                           >
                             {inst.name}
                           </div>
                           <div className="mt-0.5 flex flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap">
                             <span className="shrink-0 font-mono text-[13px] text-content-muted" title={inst.id}>
                               {inst.id.length > 20 ? `${inst.id.slice(0, 8)}…${inst.id.slice(-4)}` : inst.id}
                             </span>
                             {inst.archived && <span className="text-[13px] font-semibold bg-indigo-50/50 text-indigo-600 px-1.5 py-0.2 rounded border border-indigo-100/50 shrink-0">{t("badge_archived")}</span>}
                             {currentUser.role === 'admin' && inst.owner && (
                               <div className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted/80 rounded text-[13px] text-content-muted font-semibold max-w-[80px] truncate shrink-0">
                                 <User className="w-2.5 h-2.5 shrink-0" />
                                 <span className="truncate">{inst.owner}</span>
                                </div>
                             )}
                             <div className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted border border-outline/50 rounded text-[13px] text-content-muted font-semibold shrink-0" title="已配置的通讯渠道">
                               <Globe className="w-2.5 h-2.5 text-content-muted shrink-0" />
                               <span className="truncate max-w-[100px]">{inst.configSummary?.channelLabel || inst.configSummary?.channel || "仅 Web 控制台"}</span>
                             </div>
                             <div
                              className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted border border-outline/55 rounded text-[13px] text-content-muted font-semibold shrink-0 cursor-help transition-colors hover:bg-surface-muted/80"
                              title={`${t("image_label")}: ${inst.agent_image || t("not_recorded")}\n${t("tag_label")}: ${inst.agent_image_tag || t("not_recorded")}`}
                             >
                              <Box className="w-2.5 h-2.5 shrink-0 text-content-muted" />
                              <span className="truncate max-w-[100px]">
                                {inst.resolved_version || inst.agent_version || inst.agent_image_tag ? `Hermes ${inst.resolved_version || inst.agent_version || inst.agent_image_tag}` : t("not_recorded")}
                              </span>
                             </div>
                           </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1.5 items-start">
                          {(() => {
                            const label = getRefinedStatusLabel(inst);
                            return (
                              <span className={cn(
                                "inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-md text-[13px] font-semibold border border-transparent",
                                label.textClass
                              )}>
                                <div className={cn(
                                  "w-1 h-1 rounded-full shrink-0",
                                  label.color
                                )}></div>
                                <span>{t(label.i18nKey || label.text, { defaultValue: label.text })}</span>
                              </span>
                            );
                          })()}
                          {inst.physical_error && (
                            <span className="text-[13px] font-semibold text-red-600 bg-red-50/60 px-1.5 py-0.5 rounded border border-red-150 flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5" /> {t("status_disconnect")}
                            </span>
                          )}
                          {inst.status === 'failed' && inst.deployment_error && (() => {
                            const isPasswordDecryptError = inst.deployment_error && (
                              inst.deployment_error.includes("webPasswordHash") ||
                              inst.deployment_error.includes("undecryptable") ||
                              inst.deployment_error.includes("解密") ||
                              inst.deployment_error.includes("AES-GCM")
                            );
                            if (isPasswordDecryptError) {
                              return (
                                <span
                                  className="text-[13px] text-red-500 font-semibold max-w-[180px] truncate cursor-help"
                                  title={`面板访问密码不可用，实例无法完成 Dashboard 登录配置。请重置访问密码后重新部署。\n\n技术详情: ${inst.deployment_error}`}
                                >
                                  密码未配置/重置
                                </span>
                              );
                            }
                            return (
                              <span className="text-[13px] text-red-400 font-mono max-w-[180px] truncate" title={inst.deployment_error}>
                                {inst.deployment_error}
                              </span>
                            );
                          })()}
                        </div>
                    </td>
                    <td className="min-w-0 px-4 py-3.5">
                        <button
                          className="block w-full truncate whitespace-nowrap text-left font-mono text-[12px] text-content-muted hover:text-content"
                          onClick={(e) => handleOpenLink(e, inst)}
                        >
                          {inst.url}
                        </button>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="ml-auto flex w-full flex-nowrap justify-end gap-1 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {caps.canStart && <Button disabled={actioningIds.has(inst.id)} variant="ghost" className="h-7.5 shrink-0 whitespace-nowrap px-2 text-[12px] font-semibold text-emerald-700" onClick={() => handleInstanceAction(inst.id, "start")}>{t("actions.start")}</Button>}
                        {caps.canRestart && <Button disabled={actioningIds.has(inst.id)} variant="ghost" className="h-7.5 shrink-0 whitespace-nowrap px-2 text-[12px] font-semibold text-indigo-700" onClick={() => handleInstanceAction(inst.id, "restart")}>{t("actions.restart")}</Button>}
                        {caps.canStop && <Button disabled={actioningIds.has(inst.id)} variant="ghost" className="h-7.5 shrink-0 whitespace-nowrap px-2 text-[12px] font-semibold text-content-muted" onClick={() => { if (window.confirm(t("mobile_sheet_stop_confirm"))) handleInstanceAction(inst.id, "stop"); }}>{t("actions.stop")}</Button>}
                        {caps.isFailed && <Button disabled={actioningIds.has(inst.id)} variant="ghost" className="h-7.5 shrink-0 whitespace-nowrap px-2 text-[12px] font-semibold text-amber-700" onClick={() => { if (window.confirm(t("confirm_redeploy"))) handleInstanceAction(inst.id, "redeploy"); }}>{t("mobile_sheet_redeploy_title")}</Button>}
                        <Button
                          variant="ghost"
                          className="h-7.5 px-2.5 text-[13px] font-semibold text-content-secondary border border-outline hover:bg-surface-muted rounded-md shrink-0 transition-colors flex items-center gap-1"
                          onClick={(e) => openInstanceDetail(inst.id, e)}
                          title={t("instance_detail_tooltip")}
                        >
                          {t("action_detail")}
                        </Button>
                        {caps.canRestoreFromArchive && (
                          <Button
                            variant="ghost"
                            className="h-7.5 px-2.5 text-[13px] font-semibold text-indigo-600 border border-indigo-200/65 hover:bg-indigo-50/40 rounded-md shrink-0 transition-colors flex items-center gap-1"
                            onClick={(e) => handleRestore(inst.id, e)}
                            title={t("action_restore_tooltip")}
                          >
                            <Play className="w-3 h-3" />
                            {t("action_restore")}
                          </Button>
                        )}
                        <div className="relative shrink-0">
                          <select
                            aria-label={`${t("action_more")}: ${inst.name}`}
                            className="h-8 appearance-none rounded-md border border-outline bg-surface-muted py-0 pl-2 pr-7 text-[12px] font-semibold text-content-secondary outline-none transition-colors hover:bg-control-hover focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                            defaultValue=""
                            disabled={deletingIds.has(inst.id)}
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              const action = e.currentTarget.value;
                              e.currentTarget.value = "";
                              if (action === "settings") setEditingInstance(inst);
                              if (action === "rename") onRenameInstance?.(inst);
                              if (action === "export") handleExportConfig(e as unknown as React.MouseEvent, inst.id, inst.name);
                              if (action === "archive") handleArchive(inst.id, e as unknown as React.MouseEvent);
                              if (action === "delete") handleDelete(inst.id, e as unknown as React.MouseEvent);
                            }}
                          >
                            <option value="">{t("action_more")}</option>
                            {!caps.isArchived && <option value="settings">{t("action_settings_tooltip")}</option>}
                            {!caps.isArchived && <option value="rename">{t("action_rename_tooltip")}</option>}
                            {!caps.isArchived && <option value="export">{t("action_export_archive_short")}</option>}
                            {!caps.isArchived && <option value="archive">{t("action_archive_tooltip")}</option>}
                            <option value="delete">{t("action_delete_tooltip")}</option>
                          </select>
                          <MoreHorizontal className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
                        </div>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                     <tr>
                       <td colSpan={5} className="p-0 border-b border-outline bg-surface-muted/20">
                          <div className="px-6 py-4 cursor-default">
                             <ContainerStats
                               instance={inst}
                               onReload={fetchInstances}
                               currentUser={currentUser}
                               onOpenSettings={() => setEditingInstance(inst)}
                               onViewGuide={onViewGuide}
                               onViewFiles={() => handleOpenTerminalView(inst.id, 'files')}
                               isMobile={isMobile}
                             />
                          </div>
                       </td>
                     </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
