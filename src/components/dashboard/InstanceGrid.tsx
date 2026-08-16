import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { TerminalSquare, Box, MoreVertical, Play, Download, Settings, Archive, Trash2, Check, Copy, ArrowUpRight, AlertCircle, User, Edit3, Globe } from "lucide-react";
import { AgentInstance, User as UserType } from "../../types";
import { Card, Button, cn } from "../ui";
import { ContainerStats } from "../ContainerStats";
import { getRefinedStatusLabel } from "./instanceStatus";
import { getInstanceCapabilities } from "./instanceCapabilities";
import { useTranslation } from "react-i18next";

interface InstanceGridProps {
  instances: AgentInstance[];
  viewMode: 'grid' | 'table';
  activeLogs: string | null;
  setActiveLogs: (id: string | null) => void;
  setDetailTab: (tab: 'logs' | 'files' | 'context' | 'diagnostics') => void;
  currentUser: UserType;
  copiedId: string | null;
  handleExportConfig: (e: React.MouseEvent, id: string, name: string) => void;
  handleDelete: (id: string, e?: React.MouseEvent) => void;
  handleArchive: (id: string, e?: React.MouseEvent) => void;
  handleRestore: (id: string, e?: React.MouseEvent) => void;
  handleInstanceAction: (id: string, action: string) => void;
  handleCopyUrl: (e: React.MouseEvent, url: string, instId: string) => void;
  handleOpenLink: (e: React.MouseEvent, inst: AgentInstance) => void;
  fetchInstances: () => void;
  setEditingInstance: (inst: AgentInstance) => void;
  onRenameInstance?: (inst: AgentInstance) => void;
  setMobileMenuOpenInstance: (inst: AgentInstance) => void;
  onViewGuide?: (guideId: string) => void;
  handleOpenTerminalView: (instId: string, tab: 'logs' | 'files' | 'context') => void;
  selectedInstanceIds: Set<string>;
  onSelectInstance: (id: string, selected: boolean) => void;
  deletingIds: Set<string>;
  actioningIds: Set<string>;
  isMobile?: boolean;
}

export const InstanceGrid = React.memo(function InstanceGrid({
  instances,
  viewMode,
  activeLogs,
  setActiveLogs,
  setDetailTab,
  currentUser,
  copiedId,
  handleExportConfig,
  handleDelete,
  handleArchive,
  handleRestore,
  handleInstanceAction,
  handleCopyUrl,
  handleOpenLink,
  fetchInstances,
  setEditingInstance,
  onRenameInstance,
  setMobileMenuOpenInstance,
  onViewGuide,
  handleOpenTerminalView,
  selectedInstanceIds,
  onSelectInstance,
  deletingIds,
  actioningIds,
  isMobile = false
}: InstanceGridProps) {
  const { t } = useTranslation("dashboard");
  const [activeDropdownId, setActiveDropdownId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleOutsideClick = () => {
      setActiveDropdownId(null);
    };
    document.addEventListener("click", handleOutsideClick);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, []);

  const openInstanceDetail = (instId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveLogs(instId);
    setDetailTab('logs');
  };

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6", viewMode === 'table' && "md:hidden")}>
      <AnimatePresence>
        {instances.map((inst) => {
          const caps = getInstanceCapabilities(inst);
          return (
            <motion.div
              key={inst.id}
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <Card className="relative flex flex-col p-4 hover:border-outline-strong transition-colors duration-150 rounded-xl h-full shadow-xs bg-surface border border-outline/50">

              {/* Header Hierarchy Block */}
              <div className="flex justify-between items-start gap-4 mb-3.5">
                {/* Name, Status, and ID */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2.5">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        className="rounded border-outline-strong text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        checked={selectedInstanceIds.has(inst.id)}
                        disabled={deletingIds.has(inst.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          onSelectInstance(inst.id, e.target.checked);
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    </div>
                    <h3
                      className="text-sm md:text-base font-semibold text-content no-underline leading-tight hover:text-blue-600 active:text-blue-700 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 truncate pr-1 cursor-pointer transition-colors"
                      title={t("instance_detail_tooltip") || "点击查看实例详情"}
                      aria-label={t("instance_detail_tooltip") || "点击查看实例详情"}
                      onClick={(e) => openInstanceDetail(inst.id, e)}
                    >
                      {inst.name}
                    </h3>
                    <div className="flex items-center shrink-0">
                      {(() => {
                        const label = getRefinedStatusLabel(inst);
                        return (
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[13px] font-medium leading-none shrink-0 whitespace-nowrap",
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
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-50 text-red-650 text-[13px] font-semibold rounded border border-red-100 shrink-0 whitespace-nowrap ml-1.5">
                          <AlertCircle className="w-2.5 h-2.5" />
                          {t("status_disconnect")}
                        </span>
                      )}
                    </div>
                  </div>

                  {inst.status === 'failed' && inst.deployment_error && (() => {
                    const isPasswordDecryptError = inst.deployment_error && (
                      inst.deployment_error.includes("webPasswordHash") ||
                      inst.deployment_error.includes("undecryptable") ||
                      inst.deployment_error.includes("解密") ||
                      inst.deployment_error.includes("AES-GCM")
                    );
                    return (
                      <div className="mt-2.5 p-3 bg-red-50/50 border border-red-100 rounded-lg animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="flex gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                          <div className="space-y-1 min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-red-800">{t("deploy_failure_details")}</p>
                            {isPasswordDecryptError ? (
                              <div className="space-y-1.5 text-left">
                                <p className="text-[13px] text-red-700 font-medium leading-normal">
                                  面板访问密码不可用，实例无法完成 Dashboard 登录配置。请重置访问密码后重新部署。
                                </p>
                                <details className="text-[11px] text-content-muted cursor-pointer select-none">
                                  <summary className="hover:text-content-secondary font-semibold focus:outline-none">展开技术详情</summary>
                                  <p className="mt-1 p-1.5 bg-surface border border-red-100/50 rounded font-mono break-all leading-relaxed whitespace-pre-wrap max-h-[80px] overflow-y-auto">
                                    {inst.deployment_error}
                                  </p>
                                </details>
                              </div>
                            ) : (
                              <p className="text-[13px] text-red-650 font-mono leading-relaxed break-all">
                                {inst.deployment_error}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex flex-wrap items-center gap-2 mt-1 overflow-hidden">
                    <p className="flex items-center gap-1 text-[11px] text-content-muted font-mono truncate shrink-0">
                      <TerminalSquare className="w-3 h-3 text-content-muted shrink-0" />
                      <span>{t("instance_id_prefix")}: {inst.id}</span>
                    </p>
                    {currentUser.role === 'admin' && inst.owner && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted/80 border border-outline/40 rounded-md text-[11px] text-content-muted font-medium max-w-[120px] truncate shrink-0">
                        <User className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{inst.owner}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted/80 border border-outline/40 rounded-md text-[11px] text-content-muted font-medium shrink-0" title="已配置的通讯渠道">
                      <Globe className="w-2.5 h-2.5 text-content-muted shrink-0" />
                      <span className="truncate max-w-[120px]">{inst.configSummary?.channelLabel || inst.configSummary?.channel || "仅 Web 控制台"}</span>
                    </div>
                    <div
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-muted/80 border border-outline/40 rounded-md text-[11px] text-content-muted font-medium shrink-0 cursor-help transition-colors hover:bg-surface-muted"
                      title={`${t("image_label")}: ${inst.agent_image || t("not_recorded")}\n${t("tag_label")}: ${inst.agent_image_tag || t("not_recorded")}`}
                    >
                      <Box className="w-2.5 h-2.5 shrink-0 text-content-muted" />
                      <span className="truncate max-w-[150px]">
                        {inst.resolved_version || inst.agent_version || inst.agent_image_tag ? `Hermes ${inst.resolved_version || inst.agent_version || inst.agent_image_tag}` : t("version_not_recorded")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operations Triggers */}
                <div className="shrink-0 flex items-center z-10" onClick={e => e.stopPropagation()}>
                  {/* Mobile view manager sheet trigger */}
                  <div className="md:hidden">
                    <Button
                      variant="outline"
                      className="bg-surface-muted/50 hover:bg-surface-muted border-outline px-3 h-8.5 rounded-lg text-[13px] font-semibold text-content-secondary flex items-center gap-1 transition-colors active:scale-95 shadow-xs"
                      onClick={(e) => { e.stopPropagation(); setMobileMenuOpenInstance(inst); }}
                    >
                      <MoreVertical className="w-3.5 h-3.5 text-content-muted" />
                      <span>{t("action_manage")}</span>
                    </Button>
                  </div>

                  {/* Desktop actions triggers */}
                  <div className="hidden md:flex gap-1.5 relative">
                    {caps.canRestoreFromArchive ? (
                      <Button
                        variant="ghost"
                        className="h-8 px-2.5 text-[13px] font-semibold text-indigo-600 border border-indigo-200/50 hover:bg-indigo-50 rounded-md shrink-0 transition-colors flex items-center gap-1.5"
                        onClick={(e) => handleRestore(inst.id, e)}
                        title={t("action_restore_tooltip")}
                      >
                        <Play className="w-3.5 h-3.5" />
                        {t("action_restore")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="h-8 px-2.5 text-[13px] font-semibold text-content-secondary border border-outline hover:bg-surface-muted rounded-md shrink-0 transition-colors flex items-center gap-1.5"
                        onClick={(e) => openInstanceDetail(inst.id, e)}
                        title={t("instance_detail_tooltip")}
                      >
                        {t("action_detail")}
                      </Button>
                    )}

                    <div className="relative">
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 text-content-muted hover:text-content-secondary border border-outline hover:bg-surface-muted rounded-md shrink-0 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdownId(activeDropdownId === inst.id ? null : inst.id);
                        }}
                        title={t("action_manage")}
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </Button>

                      {activeDropdownId === inst.id && (
                        <div
                          className="absolute right-0 top-full mt-1 bg-surface border border-outline rounded-lg shadow-lg py-1.5 z-40 min-w-[140px] animate-in fade-in slide-in-from-top-1 duration-150"
                          onClick={e => e.stopPropagation()}
                        >
                          {!caps.isArchived && (
                            <>
                              {caps.canStart && <button disabled={actioningIds.has(inst.id)} className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" onClick={() => { handleInstanceAction(inst.id, "start"); setActiveDropdownId(null); }}>{t("actions.start")}</button>}
                              {caps.canRestart && <button disabled={actioningIds.has(inst.id)} className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50" onClick={() => { handleInstanceAction(inst.id, "restart"); setActiveDropdownId(null); }}>{t("actions.restart")}</button>}
                              {caps.canStop && <button disabled={actioningIds.has(inst.id)} className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-content-secondary hover:bg-surface-muted disabled:opacity-50" onClick={() => { if (window.confirm(t("mobile_sheet_stop_confirm"))) handleInstanceAction(inst.id, "stop"); setActiveDropdownId(null); }}>{t("actions.stop")}</button>}
                              {caps.isFailed && <button disabled={actioningIds.has(inst.id)} className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50" onClick={() => { if (window.confirm(t("confirm_redeploy"))) handleInstanceAction(inst.id, "redeploy"); setActiveDropdownId(null); }}>{t("mobile_sheet_redeploy_title")}</button>}
                              <button
                                className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-content-secondary hover:bg-surface-muted transition-colors flex items-center gap-2"
                                onClick={(e) => { e.stopPropagation(); setEditingInstance(inst); setActiveDropdownId(null); }}
                              >
                                <Settings className="w-3.5 h-3.5 text-content-muted" />
                                <span>{t("action_settings_tooltip") || "实例设置"}</span>
                              </button>
                              <button
                                className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-content-secondary hover:bg-surface-muted transition-colors flex items-center gap-2"
                                onClick={(e) => { e.stopPropagation(); onRenameInstance?.(inst); setActiveDropdownId(null); }}
                              >
                                <Edit3 className="w-3.5 h-3.5 text-content-muted" />
                                <span>{t("action_rename_tooltip") || "重命名"}</span>
                              </button>
                              <button
                                className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-indigo-605 hover:bg-surface-muted transition-colors flex items-center gap-2"
                                onClick={(e) => { handleExportConfig(e, inst.id, inst.name); setActiveDropdownId(null); }}
                                title={t("action_export_archive_tooltip")}
                              >
                                <Download className="w-3.5 h-3.5 text-indigo-400" />
                                <span>{t("action_export_archive_short") || "导出"}</span>
                              </button>
                              <button
                                className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-amber-600 hover:bg-surface-muted transition-colors flex items-center gap-2"
                                onClick={(e) => { handleArchive(inst.id, e); setActiveDropdownId(null); }}
                                disabled={deletingIds.has(inst.id)}
                              >
                                <Archive className="w-3.5 h-3.5 text-amber-400" />
                                <span>{t("action_archive_tooltip") || "归档实例"}</span>
                              </button>
                            </>
                          )}
                          <button
                            className="w-full px-3 py-1.5 text-left text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2 border-t border-outline"
                            onClick={(e) => { handleDelete(inst.id, e); setActiveDropdownId(null); }}
                            disabled={deletingIds.has(inst.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            <span>{t("action_delete_tooltip") || "删除实例"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* URL Access Block */}
              <div className="flex flex-col gap-1.5 mb-3.5 bg-surface-muted p-2.5 rounded-lg border border-outline/40" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center px-0.5">
                  <span className="text-[13px] font-medium text-content-muted uppercase tracking-wider">{t("public_access_network")}</span>
                  <AnimatePresence>
                    {copiedId === inst.id && (
                      <motion.span
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-[13px] text-green-600 font-medium flex items-center gap-1"
                      >
                        <Check className="w-2.5 h-2.5" /> {t("copied_to_clipboard")}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                <div className="flex items-center justify-between gap-2 bg-surface px-2.5 py-1.5 rounded-md border border-outline/40 min-w-0">
                  <div className="font-mono text-[13px] text-content-muted hover:text-content-secondary break-all select-all min-w-0 truncate pr-1">
                    {inst.url ? inst.url.replace(/^https?:\/\//, '') : t("no_public_route")}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className="p-1 hover:bg-surface-muted rounded text-content-muted hover:text-content-secondary transition-colors active:scale-95"
                      onClick={(e) => handleCopyUrl(e, inst.url, inst.id)}
                      title={t("copy_address_tooltip")}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      className="p-1 hover:bg-surface-muted rounded text-content-muted hover:text-content-secondary transition-colors active:scale-95"
                      onClick={(e) => handleOpenLink(e, inst)}
                      title={t("open_in_new_window_tooltip")}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Uniform Metrics & Configurations */}
              <ContainerStats
                instance={inst}
                onReload={fetchInstances}
                currentUser={currentUser}
                onOpenSettings={() => setEditingInstance(inst)}
                onViewGuide={onViewGuide}
                onViewFiles={() => handleOpenTerminalView(inst.id, 'files')}
                isMobile={isMobile}
              />
            </Card>
          </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
