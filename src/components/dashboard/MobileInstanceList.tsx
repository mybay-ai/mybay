import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { MoreVertical, Box, Globe, Shield, TerminalSquare, ExternalLink, Copy, Check, User as UserIcon, ChevronDown, ChevronUp } from "lucide-react";
import { AgentInstance, User as UserType } from "../../types";
import { Button, cn } from "../ui";
import { getRefinedStatusLabel } from "./instanceStatus";
import { useTranslation } from "react-i18next";
import { ContainerStats } from "../ContainerStats";

interface MobileInstanceListProps {
  instances: AgentInstance[];
  setActiveLogs: (id: string | null) => void;
  setDetailTab: (tab: 'logs' | 'files' | 'context' | 'diagnostics') => void;
  setMobileMenuOpenInstance: (inst: AgentInstance) => void;
  currentUser: UserType;
  handleCopyUrl: (e: React.MouseEvent, url: string, instId: string) => void;
  handleOpenLink: (e: React.MouseEvent, inst: AgentInstance) => void;
  copiedId: string | null;
  fetchInstances?: () => void;
  setEditingInstance?: (inst: AgentInstance) => void;
  onRenameInstance?: (inst: AgentInstance) => void;
  onViewGuide?: (guideId: string) => void;
  handleOpenTerminalView?: (instId: string, tab: 'logs' | 'files' | 'context') => void;
  isMobile?: boolean;
}

export const MobileInstanceList = React.memo(function MobileInstanceList({
  instances,
  setActiveLogs,
  setDetailTab,
  setMobileMenuOpenInstance,
  currentUser,
  handleCopyUrl,
  handleOpenLink,
  copiedId,
  fetchInstances,
  setEditingInstance,
  onRenameInstance,
  onViewGuide,
  handleOpenTerminalView,
  isMobile = false
}: MobileInstanceListProps) {
  const { t } = useTranslation("dashboard");

  // Local state to track which instance card is expanded inline in the mobile list.
  // This completely decouples card expansion from the full activeLogs detail panel.
  const [expandedInstanceId, setExpandedInstanceId] = React.useState<string | null>(null);

  const toggleExpand = (instId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedInstanceId(prev => prev === instId ? null : instId);
  };

  const openInstanceDetail = (instId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveLogs(instId);
    setDetailTab('logs');
  };

  return (
    <div className="flex flex-col gap-3 md:hidden">
      <AnimatePresence>
        {instances.map((inst) => {
          const label = getRefinedStatusLabel(inst);
          const isExpanded = expandedInstanceId === inst.id;
          const isCopied = copiedId === inst.id;

          return (
            <motion.div
              key={inst.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "bg-surface border rounded-xl overflow-hidden transition-all active:scale-[0.99]",
                isExpanded ? "border-outline-strong shadow-sm" : "border-outline/50 shadow-xs"
              )}
            >
              <div className="p-3.5 flex items-center justify-between gap-3">
                <div 
                  className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer select-none group"
                  onClick={(e) => toggleExpand(inst.id, e)}
                  title={t("expand_summary_tooltip") || "点击展开/收起摘要"}
                >
                  <div className={cn("w-1 h-9 rounded-full shrink-0", label.color.replace('text-', 'bg-'))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold text-content leading-tight group-hover:text-blue-600 transition-colors truncate">
                        {inst.name}
                      </h3>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5 text-content-muted shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-content-muted shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={cn(
                        "inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-md",
                        label.textClass,
                        label.color.replace('text-', 'bg-') + "/10"
                      )}>
                        {t(label.i18nKey || label.text, { defaultValue: label.text })}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
                      <span className="text-[11px] text-content-muted font-mono truncate">
                        {t("instance_id_prefix")}: {inst.id.substring(0, 8)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick actions for mobile */}
                <div className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => openInstanceDetail(inst.id, e)}
                    className="h-7.5 rounded-lg px-2 text-[11px] font-medium text-content-secondary border border-outline hover:bg-surface-muted flex items-center gap-1 active:scale-95"
                  >
                    <span>{t("action_detail")}</span>
                  </Button>
                  {inst.url && (
                    <>
                      <button
                        onClick={(e) => handleCopyUrl(e, inst.url, inst.id)}
                        className={cn(
                          "w-7.5 h-7.5 flex items-center justify-center rounded-lg transition-colors border",
                          isCopied ? "bg-green-50 border-green-200 text-green-600" : "bg-surface border-outline text-content-muted hover:text-content-secondary"
                        )}
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={(e) => handleOpenLink(e, inst)}
                        className="w-7.5 h-7.5 flex items-center justify-center bg-surface border border-outline rounded-lg text-content-muted hover:text-content-secondary transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMobileMenuOpenInstance(inst)}
                    className="bg-surface-muted/50 hover:bg-surface-muted border-outline h-7.5 rounded-lg px-2 text-[11px] font-medium text-content-secondary flex items-center gap-1 shadow-xs active:scale-95"
                  >
                    <MoreVertical className="w-3 h-3" />
                    <span>{t("action_manage")}</span>
                  </Button>
                </div>
              </div>

              {/* Expandable summary info */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-outline bg-surface-muted/30 overflow-hidden"
                  >
                    <div className="p-3.5 pt-1.5 pb-4 space-y-2.5">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-surface/80 p-2 rounded-lg border border-outline/40">
                          <div className="flex items-center gap-1.5 mb-1 text-[9px] text-content-muted font-medium uppercase tracking-wider">
                            <Shield className="w-3 h-3" />
                            <span>{t("info_engine_version")}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Box className="w-3 h-3 text-content-muted" />
                            <span className="text-[11px] font-medium text-content-secondary truncate">
                              {inst.resolved_version || inst.agent_image_tag || t("latest")}
                            </span>
                          </div>
                        </div>
                        <div className="bg-surface/80 p-2 rounded-lg border border-outline/40">
                          <div className="flex items-center gap-1.5 mb-1 text-[9px] text-content-muted font-medium uppercase tracking-wider">
                            <TerminalSquare className="w-3 h-3" />
                            <span>{t("info_status_code")}</span>
                          </div>
                          <span className="text-[11px] font-mono text-content-muted">{inst.status}</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-2 bg-surface/80 rounded-lg border border-outline/40">
                          <div className="flex items-center gap-1.5 text-[11px] text-content-muted font-medium">
                            <Globe className="w-3.5 h-3.5 text-content-muted" />
                            <span>{t("info_private_link")}</span>
                          </div>
                          <span className="text-[11px] font-mono text-content-muted truncate max-w-[170px]">
                            {inst.url ? inst.url.replace(/^https?:\/\//, '') : t("not_configured")}
                          </span>
                        </div>

                        {currentUser.role === 'admin' && inst.owner && (
                          <div className="flex items-center justify-between p-2.5 bg-surface/80 rounded-xl border border-outline">
                            <div className="flex items-center gap-2 text-[13px] text-content-muted font-medium">
                              <UserIcon className="w-3.5 h-3.5 text-content-muted" />
                              <span>{t("info_owner")}</span>
                            </div>
                            <span className="text-[13px] font-bold text-content">{inst.owner}</span>
                          </div>
                        )}
                      </div>

                      {/* Lazy loaded metrics & diagnostics when expanded */}
                      <div className="pt-3 border-t border-outline" onClick={e => e.stopPropagation()}>
                        <ContainerStats 
                          instance={inst}
                          onReload={fetchInstances || (() => {})}
                          currentUser={currentUser}
                          onOpenSettings={setEditingInstance ? () => setEditingInstance(inst) : undefined}
                          onViewGuide={onViewGuide}
                          onViewFiles={handleOpenTerminalView ? () => handleOpenTerminalView(inst.id, 'files') : undefined}
                          isMobile={isMobile}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});
