import React from "react";
import { AlertCircle, ArrowUpRight, Box, CheckCircle, ChevronDown, History, Loader2, Terminal } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { useTranslation } from "react-i18next";
import { getUpgradePhaseLabel } from "./versionStatusPresentation";
import { normalizeAgentUpgradePhase } from "../../../shared/agentUpgradePhase";

interface VersionMobileInstanceCardsProps {
  filteredInstances: any[];
  selectedInstances: string[];
  versions: any[];
  rollingBackId: string | null;
  doesInstanceNeedUpdate: (instance: any) => boolean;
  toggleSelectInstance: (id: string) => void;
  setDetailsInstanceId: (id: string) => void;
  handleOpenLogs: (id: string, event: React.MouseEvent) => void;
  handleRollbackSingle: (id: string, event: React.MouseEvent) => void;
  handleUpgradeSingle: (id: string, tag: string, event: React.MouseEvent) => void;
}

export function VersionMobileInstanceCards({
  filteredInstances,
  selectedInstances,
  versions,
  rollingBackId,
  doesInstanceNeedUpdate,
  toggleSelectInstance,
  setDetailsInstanceId,
  handleOpenLogs,
  handleRollbackSingle,
  handleUpgradeSingle
}: VersionMobileInstanceCardsProps) {
  const { t } = useTranslation("dashboard");

  return (
      <div className="xl:hidden space-y-4">
        {filteredInstances.length === 0 ? (
          <div className="text-center py-12 text-content-muted bg-surface border border-outline rounded-2xl">
            <Box className="w-8 h-8 text-content-muted mx-auto mb-2" />
            <span>{t("versionManagement.table.empty")}</span>
          </div>
        ) : (
          filteredInstances.map((inst) => {
            const isSelected = selectedInstances.includes(inst.id);
            const currentTag = inst.agent_image_tag || "latest";
            const activeVersion = inst.resolved_version || inst.agent_version || currentTag;
            const upgradeStatus = inst.upgrade_status;
            const upgradePhase = normalizeAgentUpgradePhase(inst.upgrade_phase, upgradeStatus);
            const previousTag = inst.previous_image_tag;
            const hasPendingUpdate = doesInstanceNeedUpdate(inst);

            return (
              <Card key={inst.id} className={cn("p-4 space-y-4 border transition-all", isSelected ? "border-blue-500 bg-blue-50/10 shadow-md" : "border-outline")}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectInstance(inst.id)}
                      className="w-4 h-4 rounded text-blue-600 border-outline-strong focus:ring-blue-500 cursor-pointer"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-content truncate">{inst.name}</div>
                      <div className="text-[11px] text-content-muted font-mono">{inst.id}</div>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setDetailsInstanceId(inst.id); }}
                      className="h-8 w-8 p-0 rounded-lg text-content-muted"
                      title={t("versionManagement.table.detailsTitle")}
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={(e) => handleOpenLogs(inst.id, e)}
                      className="h-8 w-8 p-0 rounded-lg text-content-muted"
                    >
                      <Terminal className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div className="space-y-1">
                    <p className="text-content-muted font-bold uppercase tracking-wider text-[11px]">{t("versionManagement.table.currentVersion")}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-content-secondary">{activeVersion}</span>
                      {hasPendingUpdate && (
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-content-muted font-bold uppercase tracking-wider text-[11px]">{t("versionManagement.mobile.upgradeStatus")}</p>
                    <div>
                      {["queued", "pulling_image", "rebuilding", "health_check", "chat_ready", "rolling_back"].includes(upgradePhase) ? (
                        <span className="text-blue-600 font-bold flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {getUpgradePhaseLabel(t, inst)}
                        </span>
                      ) : upgradePhase === "completed" || upgradePhase === "rolled_back" ? (
                        <span className="text-green-600 font-bold flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {getUpgradePhaseLabel(t, inst)}
                        </span>
                      ) : upgradePhase === "failed" ? (
                        <span className="text-red-600 font-bold flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {getUpgradePhaseLabel(t, inst)}
                        </span>
                      ) : (
                        <span className="text-content-muted">{getUpgradePhaseLabel(t, inst)}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-outline">
                  {previousTag && previousTag !== currentTag && (
                    <Button
                      onClick={(e) => handleRollbackSingle(inst.id, e)}
                      disabled={rollingBackId === inst.id || upgradeStatus === "upgrading"}
                      className="flex-1 h-9 bg-orange-50 border border-orange-100 text-orange-700 text-[13px] font-bold rounded-xl"
                    >
                      {rollingBackId === inst.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <History className="w-4 h-4" />}
                      {t("versionManagement.details.rollback")}
                    </Button>
                  )}
                  <div className="relative flex-1">
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleUpgradeSingle(inst.id, e.target.value, e as any);
                          e.target.value = "";
                        }
                      }}
                       disabled={upgradeStatus === "upgrading"}
                      className="w-full bg-surface-muted border border-outline h-9 px-3 rounded-xl text-[13px] font-bold appearance-none outline-none"
                    >
                      <option value="">{t("versionManagement.table.scheduleUpgrade")}</option>
                      <option value="latest">{t("versionManagement.table.followLatest")}</option>
                      {versions.map(v => {
                        const isFeishuInst = inst.configuredChannels?.includes("feishu") || inst.configuredChannels?.includes("lark") || inst.channel === "feishu" || inst.channel === "lark";
                        const isFeishuCapable = v.capabilities?.includes("feishu") || v.feishu_capable === true;
                        const isFeishuIncompatible = isFeishuInst && !isFeishuCapable;
                        return (
                          <option key={v.tag} value={v.tag} disabled={isFeishuIncompatible}>
                            {v.tag} {v.is_prewarmed ? "⚡" : ""} {isFeishuIncompatible ? ` (${t("versionRepository.feishuUnsupported")})` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="w-3 h-3 text-content-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
  );
}
