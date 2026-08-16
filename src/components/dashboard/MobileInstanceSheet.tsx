import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { X, Play, RefreshCw, Square, Settings, Archive, Download, Trash2, Box, Terminal, Folder, Edit3, Briefcase } from "lucide-react";
import { AgentInstance } from "../../types";
import { cn } from "../ui";
import { getInstanceCapabilities } from "./instanceCapabilities";

interface MobileInstanceSheetProps {
  mobileMenuOpenInstance: AgentInstance | null;
  setMobileMenuOpenInstance: (inst: AgentInstance | null) => void;
  handleInstanceAction: (id: string, action: string, requireConfirm?: boolean, confirmMsg?: string) => void;
  actioningIds: Set<string>;
  handleRecheckHealth: (id: string) => void;
  setEditingInstance: (inst: AgentInstance) => void;
  onRenameInstance?: (inst: AgentInstance) => void;
  handleArchive: (id: string) => void;
  handleRestore: (id: string, e?: React.MouseEvent) => void;
  handleExportConfig: (e: React.MouseEvent, id: string, name: string) => void;
  handleDelete: (id: string, e?: React.MouseEvent) => void;
  handleOpenTerminalView: (instId: string, tab: 'logs' | 'files' | 'context') => void;
}

export function MobileInstanceSheet({
  mobileMenuOpenInstance,
  setMobileMenuOpenInstance,
  handleInstanceAction,
  actioningIds,
  handleRecheckHealth,
  setEditingInstance,
  onRenameInstance,
  handleArchive,
  handleRestore,
  handleExportConfig,
  handleDelete,
  handleOpenTerminalView
}: MobileInstanceSheetProps) {
  const { t } = useTranslation("dashboard");
  if (!mobileMenuOpenInstance) return null;

  const caps = getInstanceCapabilities(mobileMenuOpenInstance);
  const isActioning = actioningIds.has(mobileMenuOpenInstance.id);

  const closeAndExecute = (fn: () => void) => {
    setMobileMenuOpenInstance(null);
    fn();
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/75 z-[100] md:hidden"
        onClick={() => setMobileMenuOpenInstance(null)}
      />
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-2xl shadow-xl z-[101] p-5 pb-8 md:hidden border-t border-outline/80"
      >
        <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-content truncate">{mobileMenuOpenInstance.name}</h3>
            <p className="text-content-muted font-mono text-[11px] mt-0.5">{t("instance_id_prefix")}: {mobileMenuOpenInstance.id}</p>
          </div>
          <button 
            className="w-8 h-8 bg-surface-muted border border-outline/50 rounded-lg flex items-center justify-center text-content-muted hover:text-content-secondary active:scale-95 transition-transform"
            onClick={() => setMobileMenuOpenInstance(null)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 overflow-y-auto max-h-[60vh] pb-4 pr-0.5">
          {/* 1. 常规操作区：启动 / 重启 / 停止 */}
          {!caps.isArchived && (caps.canStart || caps.canRestart || caps.canStop) && (
            <div className="grid grid-cols-2 gap-2.5">
              {caps.canStart && (
                <button 
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-50/40 border border-emerald-100 text-emerald-700 font-semibold active:bg-emerald-100/40 transition-colors",
                    !caps.canRestart && !caps.canStop && "col-span-2 py-4 flex-row justify-center"
                  )}
                  onClick={() => closeAndExecute(() => handleInstanceAction(mobileMenuOpenInstance.id, 'start'))}
                  disabled={isActioning}
                >
                  <Play className="w-4.5 h-4.5" />
                  <span className="text-[13px]">{t("actions.start")}</span>
                </button>
              )}
              
              {caps.canRestart && (
                <button 
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl bg-indigo-50/40 border border-indigo-100 text-indigo-700 font-semibold active:bg-indigo-100/40 transition-colors",
                    !caps.canStart && !caps.canStop && "col-span-2 py-4 flex-row justify-center"
                  )}
                  onClick={() => closeAndExecute(() => handleInstanceAction(mobileMenuOpenInstance.id, 'restart'))}
                  disabled={isActioning}
                >
                  <RefreshCw className="w-4.5 h-4.5" />
                  <span className="text-[13px]">{t("actions.restart")}</span>
                </button>
              )}
              
              {caps.canStop && (
                <button 
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-xl bg-surface-muted border border-outline/60 text-content-secondary font-semibold active:bg-surface-muted transition-colors",
                    !caps.canRestart && "col-span-2 py-4 flex-row justify-center"
                  )}
                  onClick={() => closeAndExecute(() => handleInstanceAction(mobileMenuOpenInstance.id, 'stop', true, t("mobile_sheet_stop_confirm")))}
                  disabled={isActioning}
                >
                  <Square className="w-4 h-4 text-content-muted" />
                  <span className="text-[13px]">{t("actions.stop")}</span>
                </button>
              )}
            </div>
          )}

          {/* 2. 维护操作区：重新部署 / 刷新网关 / 从归档恢复 */}
          {caps.isArchived ? (
            <button 
              className="flex items-center gap-3.5 p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-200/50 text-indigo-700 font-medium active:bg-indigo-100/50 transition-colors shadow-xs w-full"
              onClick={() => closeAndExecute(() => handleRestore(mobileMenuOpenInstance.id))}
            >
              <RefreshCw className="w-4.5 h-4.5 text-indigo-600" />
              <div className="text-left">
                <p className="text-[13px] font-semibold">{t("mobile_sheet_restore_title")}</p>
                <p className="text-[11px] text-indigo-500 font-normal">{t("mobile_sheet_restore_desc")}</p>
              </div>
            </button>
          ) : (
            <>
              <button 
                className="flex items-center gap-3.5 p-3.5 rounded-xl bg-indigo-50/50 border border-indigo-200/50 text-indigo-700 font-medium active:bg-indigo-100/50 transition-colors shadow-xs w-full"
                onClick={() => closeAndExecute(() => handleInstanceAction(mobileMenuOpenInstance.id, 'redeploy', true, t('confirm_redeploy')))}
              >
                <RefreshCw className="w-4.5 h-4.5 text-indigo-600" />
                <div className="text-left">
                  <p className="text-[13px] font-semibold">{t("mobile_sheet_redeploy_title")}</p>
                  <p className="text-[11px] text-indigo-500 font-normal">{t("mobile_sheet_redeploy_desc")}</p>
                </div>
              </button>

              <button 
                className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface-muted border border-outline text-content-secondary font-medium active:bg-surface-muted transition-colors shadow-xs w-full"
                onClick={() => closeAndExecute(() => handleInstanceAction(
                  mobileMenuOpenInstance.id, 
                  'rebuild_proxy', 
                  true, 
                  mobileMenuOpenInstance.proxyMode === 'traefik' ? t('confirm_refresh_gateway_traefik') : t('confirm_refresh_gateway_nginx')
                ))}
              >
                <RefreshCw className="w-4.5 h-4.5 text-content-muted animate-spin-once" />
                <div className="text-left">
                  <p className="text-[13px] font-semibold">{t("btn_refresh_gateway")}</p>
                  <p className="text-[11px] text-content-muted font-normal line-clamp-2">{t("tooltip_refresh_gateway")}</p>
                </div>
              </button>
            </>
          )}

          {/* 3. 配置与查看区：配置修改 / 重命名 / 日志 / 文件 / 上下文 */}
          <button 
            className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface border border-outline text-content-secondary font-medium active:bg-surface-muted transition-colors w-full"
            onClick={() => { setEditingInstance(mobileMenuOpenInstance); setMobileMenuOpenInstance(null); }}
          >
            <Settings className="w-4.5 h-4.5 text-content-muted" />
            <div className="text-left">
              <p className="text-[13px] font-semibold">{t("mobile_sheet_settings_title")}</p>
              <p className="text-[11px] text-content-muted font-normal">{t("mobile_sheet_settings_desc")}</p>
            </div>
          </button>

          <button 
            className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface border border-outline text-content-secondary font-medium active:bg-surface-muted transition-colors w-full"
            onClick={() => { onRenameInstance?.(mobileMenuOpenInstance); setMobileMenuOpenInstance(null); }}
          >
            <Edit3 className="w-4.5 h-4.5 text-content-muted" />
            <div className="text-left">
              <p className="text-[13px] font-semibold">{t("mobile_sheet_rename_title")}</p>
              <p className="text-[11px] text-content-muted font-normal">{t("mobile_sheet_rename_desc")}</p>
            </div>
          </button>

          <div className="grid grid-cols-3 gap-2.5">
            <button 
              className="flex items-center justify-center gap-1.5 p-3 rounded-xl bg-surface-muted border border-outline/50 text-content-secondary font-medium active:bg-surface-muted transition-colors"
              onClick={() => closeAndExecute(() => handleOpenTerminalView(mobileMenuOpenInstance.id, 'logs'))}
            >
              <Terminal className="w-4 h-4 text-content-muted" />
              <span className="text-[13px] font-medium">{t("mobile_sheet_logs")}</span>
            </button>
            <button 
              className="flex items-center justify-center gap-1.5 p-3 rounded-xl bg-surface-muted border border-outline/50 text-content-secondary font-medium active:bg-surface-muted transition-colors"
              onClick={() => closeAndExecute(() => handleOpenTerminalView(mobileMenuOpenInstance.id, 'files'))}
            >
              <Folder className="w-4 h-4 text-content-muted" />
              <span className="text-[13px] font-medium">{t("mobile_sheet_files")}</span>
            </button>
            <button 
              className="flex items-center justify-center gap-1.5 p-3 rounded-xl bg-surface-muted border border-outline/50 text-content-secondary font-medium active:bg-surface-muted transition-colors"
              onClick={() => closeAndExecute(() => handleOpenTerminalView(mobileMenuOpenInstance.id, 'context'))}
            >
              <Briefcase className="w-4 h-4 text-content-muted" />
              <span className="text-[13px] font-medium">{t("instance_detail_context_tab", "上下文")}</span>
            </button>
          </div>

          {/* 4. 危险操作区：归档 / 检查状态 / 导出 / 删除 */}
          {caps.canArchive && (
            <button 
               className="flex items-center gap-3.5 p-3.5 rounded-xl bg-amber-50/40 border border-amber-200/50 text-amber-700 font-medium active:bg-amber-100 transition-colors w-full"
               onClick={() => closeAndExecute(() => handleArchive(mobileMenuOpenInstance.id))}
            >
              <Archive className="w-4.5 h-4.5 text-amber-500" />
              <div className="text-left">
                <p className="text-[13px] font-semibold">{t("mobile_sheet_archive_title")}</p>
                <p className="text-[11px] text-amber-600 font-normal font-mono">{t("mobile_sheet_archive_desc")}</p>
              </div>
            </button>
          )}

          <button 
            className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface-muted/50 border border-outline/60 text-content-secondary font-medium active:bg-surface-muted transition-colors w-full"
            onClick={() => closeAndExecute(() => handleRecheckHealth(mobileMenuOpenInstance.id))}
          >
            <Box className="w-4.5 h-4.5 text-content-muted" />
            <div className="text-left">
              <p className="text-[13px] font-semibold">{t("mobile_sheet_recheck_title")}</p>
              <p className="text-[11px] text-content-muted font-normal">{t("mobile_sheet_recheck_desc")}</p>
            </div>
          </button>

          <button 
            className="flex items-center gap-3.5 p-3.5 rounded-xl bg-surface border border-outline text-content-secondary font-medium active:bg-surface-muted transition-colors w-full"
            onClick={(e) => closeAndExecute(() => handleExportConfig(e, mobileMenuOpenInstance.id, mobileMenuOpenInstance.name))}
          >
            <Download className="w-4.5 h-4.5 text-content-muted" />
            <div className="text-left">
              <p className="text-[13px] font-semibold">{t("mobile_sheet_export_archive_title")}</p>
              <p className="text-[11px] text-content-muted font-normal">{t("mobile_sheet_export_archive_desc")}</p>
            </div>
          </button>
          <div className="h-px bg-surface-muted my-1" />
          <button 
            className="flex items-center gap-3.5 p-3.5 rounded-xl bg-red-50/40 border border-red-100 text-red-600 font-medium active:bg-red-50 transition-colors shadow-xs"
            onClick={(e) => closeAndExecute(() => handleDelete(mobileMenuOpenInstance.id, e))}
          >
            <Trash2 className="w-4.5 h-4.5" />
            <div className="text-left">
              <p className="text-[13px] font-semibold uppercase tracking-tight">{t("mobile_sheet_delete_title")}</p>
              <p className="text-[11px] text-red-400 font-normal">{t("mobile_sheet_delete_desc")}</p>
            </div>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
