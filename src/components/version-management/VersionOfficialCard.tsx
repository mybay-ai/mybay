import React from "react";
import { CheckCircle, Layers, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Card, cn } from "../ui";

interface VersionOfficialCardProps {
  currentUser: any;
  latestOfficial: any;
  latestOfficialVer: string;
  syncingOfficial: boolean;
  prewarmingVersion: string | null;
  onSyncOfficial: () => void;
  onPrewarm: (version: any) => void;
}

export function VersionOfficialCard({
  currentUser,
  latestOfficial,
  latestOfficialVer,
  syncingOfficial,
  prewarmingVersion,
  onSyncOfficial,
  onPrewarm
}: VersionOfficialCardProps) {
  const { t } = useTranslation("dashboard");
  const isReady = latestOfficial?.is_prewarmed;

  return (
    <Card className="p-4 bg-surface border border-outline rounded-2xl shadow-sm flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
      <div className="flex-1 text-left min-w-0">
        <span className="text-content-muted text-[13px] font-medium">{t("versionManagement.official.title")}</span>
        <div className="text-xl font-bold text-blue-600 mt-1 flex flex-wrap items-center gap-1.5">
          <span>{latestOfficialVer}</span>
          {isReady ? (
            <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> {t("versionManagement.official.ready")}
            </span>
          ) : (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700">{t("versionManagement.status.latest")}</span>
          )}
        </div>
      </div>
      {currentUser?.role === "admin" && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onSyncOfficial}
            disabled={syncingOfficial}
            className="h-9 px-3 bg-surface-muted border border-outline hover:bg-control-hover text-content-secondary font-semibold rounded-lg flex items-center gap-1 text-[13px] active:scale-95 transition-all"
          >
            <RefreshCw className={cn("w-3 h-3 text-content-muted", syncingOfficial && "animate-spin")} />
            <span>{t("versionManagement.actions.sync")}</span>
          </Button>
          {latestOfficial && !latestOfficial.is_prewarmed && (
            <Button
              onClick={() => onPrewarm(latestOfficial)}
              disabled={prewarmingVersion === latestOfficial.version || latestOfficial.prewarm_status === "queued" || latestOfficial.prewarm_status === "pulling"}
              className="h-9 px-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg flex items-center gap-1 text-[13px] active:scale-95 transition-all"
            >
              {latestOfficial.prewarm_status === "pulling" ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
              <span>{latestOfficial.prewarm_status === "pulling" ? t("versionRepository.statuses.pulling") : t("versionRepository.pullImage")}</span>
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
