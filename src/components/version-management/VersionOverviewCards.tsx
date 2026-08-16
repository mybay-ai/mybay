import React from "react";
import { AlertCircle, CheckCircle, Clock, Layers, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, cn } from "../ui";

interface VersionOverviewCardsProps {
  totalInstances: number;
  latestInstances: number;
  needUpdateInstances: number;
  abnormalInstances: number;
  latestBatchUpgradeAt?: number;
  refreshingInstances: boolean;
  onRefreshInstances: () => void;
}

export function VersionOverviewCards({
  totalInstances,
  latestInstances,
  needUpdateInstances,
  abnormalInstances,
  latestBatchUpgradeAt,
  refreshingInstances,
  onRefreshInstances
}: VersionOverviewCardsProps) {
  const { t } = useTranslation("dashboard");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
      <Card className="p-5 flex items-center justify-between bg-surface border border-outline rounded-2xl shadow-sm">
        <div>
          <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.stats.total")}</span>
          <div className="text-2xl font-bold text-content mt-1">{totalInstances} {t("versionManagement.stats.unit")}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-surface-muted flex items-center justify-center text-content-muted">
          <Layers className="w-5 h-5" />
        </div>
      </Card>

      <Card className="p-5 flex items-center justify-between bg-surface border border-outline rounded-2xl shadow-sm">
        <div>
          <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.stats.latest")}</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{latestInstances} {t("versionManagement.stats.unit")}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500">
          <CheckCircle className="w-5 h-5" />
        </div>
      </Card>

      <Card className="p-5 flex items-center justify-between bg-surface border border-outline rounded-2xl shadow-sm">
        <div>
          <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.stats.outdated")}</span>
          <div className="text-2xl font-bold text-amber-600 mt-1">{needUpdateInstances} {t("versionManagement.stats.unit")}</div>
        </div>
        <button
          onClick={onRefreshInstances}
          disabled={refreshingInstances}
          title={t("versionManagement.actions.refreshStats")}
          aria-label={t("versionManagement.actions.refreshStats")}
          className="w-10 h-10 rounded-xl bg-amber-50 hover:bg-amber-100 flex items-center justify-center text-amber-500 active:scale-95 transition-all focus:outline-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={cn("w-5 h-5", refreshingInstances && "animate-spin")} />
        </button>
      </Card>

      <Card className="p-5 flex items-center justify-between bg-surface border border-outline rounded-2xl shadow-sm">
        <div>
          <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.stats.abnormal")}</span>
          <div className="text-2xl font-bold text-red-600 mt-1">{abnormalInstances} {t("versionManagement.stats.unit")}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500">
          <AlertCircle className="w-5 h-5" />
        </div>
      </Card>

      <Card className="p-5 flex items-center justify-between bg-surface border border-outline rounded-2xl shadow-sm">
        <div className="min-w-0">
          <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.stats.latestBatch")}</span>
          <div className="text-sm font-bold text-content mt-2 truncate">
            {latestBatchUpgradeAt ? new Date(latestBatchUpgradeAt).toLocaleString(undefined, { hour12: false }) : t("versionManagement.stats.noBatch")}
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 shrink-0">
          <Clock className="w-5 h-5" />
        </div>
      </Card>
    </div>
  );
}
