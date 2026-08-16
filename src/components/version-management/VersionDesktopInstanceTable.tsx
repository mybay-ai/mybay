import React from "react";
import { AlertCircle, AlertTriangle, ArrowUpRight, Box, Check, CheckCircle, ChevronDown, Loader2, MoreHorizontal, Terminal } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { useTranslation } from "react-i18next";

interface VersionDesktopInstanceTableProps {
  filteredInstances: any[];
  selectedInstances: string[];
  versions: any[];
  latestOfficialVer: string;
  doesInstanceNeedUpdate: (instance: any) => boolean;
  toggleSelectInstance: (id: string) => void;
  toggleSelectAll: () => void;
  setDetailsInstanceId: (id: string) => void;
  handleOpenLogs: (id: string, event: React.MouseEvent) => void;
  handleRollbackSingle: (id: string, event: React.MouseEvent) => void;
  handleUpgradeSingle: (id: string, tag: string, event: React.MouseEvent) => void;
}

export function VersionDesktopInstanceTable({
  filteredInstances,
  selectedInstances,
  versions,
  latestOfficialVer,
  doesInstanceNeedUpdate,
  toggleSelectInstance,
  toggleSelectAll,
  setDetailsInstanceId,
  handleOpenLogs,
  handleRollbackSingle,
  handleUpgradeSingle
}: VersionDesktopInstanceTableProps) {
  const { t, i18n } = useTranslation("dashboard");

  return (
      <Card className="hidden md:block bg-surface border border-outline rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-muted border-b border-outline text-[#475569] text-[13px] font-bold">
                <th className="p-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={filteredInstances.length > 0 && filteredInstances.every(inst => selectedInstances.includes(inst.id))}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded text-blue-600 border-outline-strong focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="p-4">{t("versionManagement.table.instance")}</th>
                <th className="p-4">{t("versionManagement.table.currentVersion")}</th>
                <th className="p-4">{t("versionManagement.table.updatedAndTags")}</th>
                <th className="p-4">{t("versionManagement.table.status")}</th>
                <th className="p-4 text-right">{t("versionManagement.table.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline text-sm">
              {filteredInstances.map((inst) => {
                const isSelected = selectedInstances.includes(inst.id);
                const currentTag = inst.agent_image_tag || "latest";
                const activeVersion = inst.resolved_version || inst.agent_version || currentTag;
                const upgradeStatus = inst.upgrade_status;
                const previousTag = inst.previous_image_tag;
                const upgradeError = inst.upgrade_error;
                const hasPendingUpdate = doesInstanceNeedUpdate(inst);

                return (
                  <tr key={inst.id} className={cn("hover:bg-surface-muted/50 transition-colors", isSelected && "bg-blue-50/10")}>
                    {/* Checkbox select */}
                    <td className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectInstance(inst.id)}
                        className="w-4 h-4 rounded text-blue-600 border-outline-strong focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* Meta */}
                    <td className="p-4">
                      <div className="font-semibold text-content">{inst.name}</div>
                      <div className="text-[11px] text-content-muted font-mono mt-0.5">{inst.id}</div>
                    </td>

                    {/* Version tag */}
                    <td className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[13px] font-semibold px-2.5 py-1 rounded-lg bg-control-hover border border-outline text-content-secondary">
                          {activeVersion}
                        </span>
                        {currentTag === "latest" && (
                          <span className="text-[11px] font-medium text-content-muted px-1.5 py-0.5 rounded bg-surface-muted border border-outline font-mono">latest</span>
                        )}
                        {hasPendingUpdate && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 border border-amber-100 text-amber-700 animate-pulse">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 animate-bounce" />
                            <span>{t("versionManagement.status.outdated")}</span>
                          </span>
                        )}
                        {!hasPendingUpdate && activeVersion !== "latest" && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-50 border border-green-100 text-green-700">
                            <Check className="w-3 h-3 text-green-600" />
                            <span>{t("versionManagement.status.latest")}</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Upgrade info */}
                    <td className="p-4 text-[13px] font-mono text-content-muted">
                      {inst.last_upgrade_at ? (
                        new Date(inst.last_upgrade_at).toLocaleString(i18n.resolvedLanguage || i18n.language, { hour12: false })
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* DB Upgrade status */}
                    <td className="p-4">
                      {upgradeStatus === "upgrading" ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[13px] font-medium bg-blue-50 border border-blue-100 text-blue-700 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>{t("versionManagement.table.scheduling")}</span>
                        </span>
                      ) : upgradeStatus === "success" ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[13px] font-medium bg-green-50 border border-green-100 text-green-700">
                          <CheckCircle className="w-3 h-3" />
                          <span>{t("versionManagement.status.success")}</span>
                        </span>
                      ) : upgradeStatus === "failed" ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[13px] font-medium bg-red-50 border border-red-100 text-red-700">
                            <AlertCircle className="w-3 h-3" />
                            <span>{t("versionManagement.table.validationFailed")}</span>
                          </span>
                          {upgradeError && (
                            <p className="text-[11px] text-red-500 max-w-[200px] truncate leading-normal" title={upgradeError}>
                              {upgradeError}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-content-muted text-[13px]">—</span>
                      )}
                    </td>

                    {/* Custom upgrading controls */}
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="relative shrink-0">
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                handleUpgradeSingle(inst.id, e.target.value, e as any);
                                e.target.value = "";
                              }
                            }}
                            disabled={upgradeStatus === "upgrading"}
                            className="bg-blue-600 hover:bg-blue-500 text-white border border-blue-500 h-8 pl-2.5 pr-7 rounded-lg text-[13px] font-bold outline-none cursor-pointer focus:border-blue-300 transition-colors appearance-none disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <option value="">{t("versionManagement.table.scheduleUpgrade")}</option>
                            <option value="latest">{t("versionManagement.table.followLatest")}</option>
                            {versions.map(v => {
                              const isFeishuInst = inst.configuredChannels?.includes("feishu") || inst.configuredChannels?.includes("lark") || inst.channel === "feishu" || inst.channel === "lark";
                              const isFeishuCapable = v.capabilities?.includes("feishu") || v.feishu_capable === true;
                              const isFeishuIncompatible = isFeishuInst && !isFeishuCapable;
                              return (
                                <option key={v.tag} value={v.tag} disabled={isFeishuIncompatible}>
                                  {v.tag} {v.tag === latestOfficialVer ? `(${t("versionManagement.status.latest")})` : ""} {v.is_prewarmed ? "⚡" : ""} {isFeishuIncompatible ? ` (${t("versionRepository.feishuUnsupported")})` : ""}
                                </option>
                              );
                            })}
                          </select>
                          <ChevronDown className="w-3 h-3 text-white/80 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>

                        <Button
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); setDetailsInstanceId(inst.id); }}
                          className="h-8 px-2 rounded-lg text-content-muted hover:text-content border hover:border-outline hover:bg-surface-muted flex items-center gap-1.5 text-[13px] transition-colors"
                          title={t("versionManagement.table.detailsTitle")}
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t("versionManagement.table.details")}</span>
                        </Button>

                        <Button
                          variant="ghost"
                          onClick={(e) => handleOpenLogs(inst.id, e)}
                          className="h-8 px-2 rounded-lg text-content-muted hover:text-content border hover:border-outline hover:bg-surface-muted flex items-center gap-1.5 text-[13px] transition-colors"
                          title={t("versionManagement.table.auditTitle")}
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t("versionManagement.details.auditLogs")}</span>
                        </Button>

                        <div className="relative shrink-0">
                          <select
                            onChange={(e) => {
                              if (e.target.value === "rollback") {
                                handleRollbackSingle(inst.id, e as any);
                                e.target.value = "";
                              }
                            }}
                            disabled={upgradeStatus === "upgrading" || !previousTag || previousTag === currentTag}
                            className="bg-surface-muted hover:bg-control-hover text-content-secondary border border-outline h-8 pl-2 pr-7 rounded-lg text-[13px] font-bold outline-none cursor-pointer focus:border-blue-500 transition-colors appearance-none disabled:opacity-40 disabled:cursor-not-allowed"
                            title={previousTag && previousTag !== currentTag ? t("versionManagement.table.moreWithRollback", { version: previousTag }) : t("versionManagement.table.noMore")}
                          >
                            <option value="">{t("versionManagement.table.more")}</option>
                            {previousTag && previousTag !== currentTag && (
                              <option value="rollback">{t("versionManagement.table.rollbackTo", { version: previousTag })}</option>
                            )}
                          </select>
                          <MoreHorizontal className="w-3.5 h-3.5 text-content-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredInstances.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-content-muted">
                    <Box className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <span>{t("versionManagement.table.empty")}</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
  );
}
