import React from "react";
import { Layers, RefreshCw } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { useTranslation } from "react-i18next";

interface VersionRepositoryPreviewProps {
  versions: any[];
  currentUser: any;
  latestOfficialVer: string;
  loadingVersions: boolean;
  prewarmingVersion: string | null;
  fetchVersions: () => void;
  handlePrewarm: (version: any) => void;
}

export function VersionRepositoryPreview({
  versions,
  currentUser,
  latestOfficialVer,
  loadingVersions,
  prewarmingVersion,
  fetchVersions,
  handlePrewarm
}: VersionRepositoryPreviewProps) {
  const { t } = useTranslation("dashboard");
  return (
      <Card className="p-0 border border-outline rounded-2xl overflow-hidden shadow-sm bg-surface">
        <div className="px-5 py-4 bg-surface-muted border-b border-outline flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-content flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              {t("versionRepository.title")}
            </h4>
            <p className="text-[13px] text-content-muted mt-0.5">{t("versionRepository.subtitle")}</p>
          </div>
          <Button
            onClick={fetchVersions}
            variant="ghost"
            className="h-8 px-2.5 flex items-center gap-1.5 text-[13px] text-content-muted hover:text-content hover:bg-control-hover rounded-lg transition-all"
            title={t("versionRepository.refreshTitle")}
            aria-label={t("versionRepository.refresh")}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 text-content-muted", loadingVersions && "animate-spin")} />
            <span>{t("versionRepository.refresh")}</span>
          </Button>
        </div>
        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200">
          <table className="w-full text-left text-[13px] min-w-[700px]">
            <thead>
              <tr className="bg-surface-muted text-content-muted font-bold border-b border-outline">
                <th className="px-5 py-3 whitespace-nowrap">{t("versionRepository.versionFamily")}</th>
                <th className="px-5 py-3 whitespace-nowrap">{t("versionRepository.releaseDate")}</th>
                <th className="px-5 py-3 whitespace-nowrap">{t("versionRepository.officialImage")}</th>
                <th className="px-5 py-3 whitespace-nowrap">{t("versionRepository.capabilities")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline">
              {versions.slice(0, 3).map((v) => {
                const renderOfficialImageCell = (variant: any) => {
                  if (!variant) return <span className="text-content-muted">{t("versionRepository.notDiscovered")}</span>;
                  const isPrewarmed = variant.is_prewarmed === 1 || variant.is_prewarmed === true;
                  const status = variant.prewarm_status || (isPrewarmed ? "cached" : "idle");
                  return (
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-content-secondary">{variant.image}:{variant.tag}</span>
                      <span className={isPrewarmed ? "text-emerald-600 font-bold" : status === "failed" ? "text-red-500 font-bold" : "text-content-muted"}>
                        {t(`versionRepository.statuses.${status}`, { defaultValue: status })}
                      </span>
                      {currentUser?.role === "admin" && !isPrewarmed && status !== "pulling" && status !== "queued" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePrewarm(variant)}
                          disabled={prewarmingVersion === variant.version}
                          className="h-6 px-2 text-[11px] font-bold border-blue-200 text-blue-600 hover:bg-blue-50"
                        >
                          {t("versionRepository.pullImage")}
                        </Button>
                      )}
                    </div>
                  );
                };

                const isFamilyLatest = v.version === latestOfficialVer;

                return (
                  <tr key={v.version} className="hover:bg-surface-muted/50 transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-content-secondary">{v.version}</span>
                        {isFamilyLatest && (
                          <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[9px] font-black uppercase">{t("versionRepository.latest")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-content-muted whitespace-nowrap">{v.releaseAt}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {renderOfficialImageCell(v.coreVariant)}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex gap-1">
                        <span className="rounded bg-control-hover px-2 py-1 text-content-secondary">{t("versionRepository.core")}</span>
                        {v.capabilities?.includes("feishu") && (
                          <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{t("versionRepository.feishu")}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

  );
}
