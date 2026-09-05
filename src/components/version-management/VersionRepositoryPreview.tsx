import React from "react";
import { Layers, RefreshCw } from "lucide-react";
import { Button, Card, cn } from "../ui";
import { useTranslation } from "react-i18next";
import { VersionCapabilityBadges } from "./VersionCapabilityBadges";

interface VersionRepositoryPreviewProps {
  runtimeType: "hermes" | "pi";
  versions: any[];
  piVersions: any[];
  currentUser: any;
  latestOfficialVer: string;
  loadingVersions: boolean;
  prewarmingVersion: string | null;
  fetchVersions: () => void;
  handlePrewarm: (version: any) => void;
}

export function VersionRepositoryPreview({
  runtimeType,
  versions,
  piVersions,
  currentUser,
  latestOfficialVer,
  loadingVersions,
  prewarmingVersion,
  fetchVersions,
  handlePrewarm
}: VersionRepositoryPreviewProps) {
  const { t } = useTranslation("dashboard");

  const renderOfficialImageCell = (variant: any, compact = false) => {
    if (!variant) return <span className="text-content-muted">{t("versionRepository.notDiscovered")}</span>;
    const isPrewarmed = variant.is_prewarmed === 1 || variant.is_prewarmed === true;
    const status = variant.prewarm_status || (isPrewarmed ? "cached" : "idle");
    return (
      <div className={cn("flex gap-2", compact ? "flex-col items-start" : "items-center gap-3")}>
        <span className="max-w-full break-all font-mono text-xs text-content-secondary">{variant.image}:{variant.tag}</span>
        <div className="flex items-center gap-2">
          <span className={isPrewarmed ? "text-emerald-600 font-bold" : status === "failed" ? "text-red-500 font-bold" : "text-content-muted"}>
            {t(`versionRepository.statuses.${status}`, { defaultValue: status })}
          </span>
          {currentUser?.role === "admin" && !isPrewarmed && status !== "pulling" && status !== "queued" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handlePrewarm(variant)}
              disabled={prewarmingVersion === variant.version}
              className="h-6 px-2 text-[11px] font-bold border-blue-200 text-blue-600 hover:bg-status-info-bg"
            >
              {t("versionRepository.pullImage")}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {runtimeType === "hermes" && <Card className="p-0 border border-outline rounded-2xl overflow-hidden shadow-sm bg-surface">
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
        <div className="space-y-3 p-3 xl:hidden">
          {versions.slice(0, 3).map((v) => (
            <article key={v.version} className="rounded-xl border border-outline bg-surface-muted/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono font-bold text-content-secondary">{v.version}</span>
                  {v.version === latestOfficialVer && (
                    <span className="shrink-0 rounded bg-status-info-bg px-1.5 py-0.5 text-[9px] font-black uppercase text-status-info-text">
                      {t("versionRepository.latest")}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-content-muted">{v.releaseAt}</span>
              </div>
              <div className="mt-3 border-t border-outline pt-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-content-muted">{t("versionRepository.officialImage")}</p>
                {renderOfficialImageCell(v.coreVariant, true)}
              </div>
              <div className="mt-3">
                <VersionCapabilityBadges capabilities={v.capabilities} compact />
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto scrollbar-thin scrollbar-thumb-slate-200 xl:block">
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
                    <td className="px-5 py-3">
                      <VersionCapabilityBadges capabilities={v.capabilities} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>}
      {runtimeType === "pi" && <Card className="p-0 border border-violet-200/60 dark:border-violet-800/60 rounded-2xl overflow-hidden shadow-sm bg-surface">
        <div className="px-5 py-4 bg-violet-50/50 dark:bg-violet-950/20 border-b border-outline flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-content flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-600" />
              {t("versionRepository.piTitle")}
            </h4>
            <p className="text-[13px] text-content-muted mt-0.5">{t("versionRepository.piSubtitle")}</p>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            {t("versionRepository.runtime.certified")}
          </span>
        </div>
        <div className="divide-y divide-outline">
          {piVersions.map((version) => (
            <article key={`${version.version}-${version.tag}`} className="p-4 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-content">Pi {version.version}</span>
                    {version.is_latest && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">{t("versionRepository.latest")}</span>}
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-content-muted">{version.channel}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-content-muted">{version.releaseAt}</p>
                </div>
                <div>{renderOfficialImageCell(version, true)}</div>
                <VersionCapabilityBadges capabilities={version.capabilities} compact />
              </div>
              {version.desc && <p className="mt-3 text-[13px] leading-relaxed text-content-muted">{version.desc}</p>}
            </article>
          ))}
          {!loadingVersions && piVersions.length === 0 && (
            <p className="p-5 text-[13px] text-content-muted">{t("versionRepository.notDiscovered")}</p>
          )}
        </div>
      </Card>}
    </div>
  );
}
