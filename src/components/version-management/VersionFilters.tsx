import React from "react";
import { Filter, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "../ui";

interface VersionFiltersProps {
  searchQuery: string;
  versionFilter: string;
  statusFilter: string;
  systemTagFilter: string;
  visibleVersions: string[];
  visibleSystemTags: string[];
  filteredCount: number;
  totalCount: number;
  onSearchQueryChange: (value: string) => void;
  onVersionFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onSystemTagFilterChange: (value: string) => void;
}

export function VersionFilters({
  searchQuery,
  versionFilter,
  statusFilter,
  systemTagFilter,
  visibleVersions,
  visibleSystemTags,
  filteredCount,
  totalCount,
  onSearchQueryChange,
  onVersionFilterChange,
  onStatusFilterChange,
  onSystemTagFilterChange
}: VersionFiltersProps) {
  const { t } = useTranslation("dashboard");

  return (
    <Card className="p-4 bg-surface border border-outline rounded-2xl shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-content-secondary font-bold text-sm">
        <Filter className="w-4 h-4 text-blue-600" />
        <span>{t("versionManagement.filters.title")}</span>
        <span className="ml-auto text-[12px] font-medium text-content-muted">
          {t("versionManagement.filters.resultCount", { visible: filteredCount, total: totalCount })}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <label className="relative block">
          <Search className="w-4 h-4 text-content-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t("versionManagement.filters.searchPlaceholder")}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-outline bg-surface-muted text-[13px] font-medium text-content-secondary outline-none focus:border-blue-400 focus:bg-surface transition-colors"
          />
        </label>
        <select
          value={versionFilter}
          onChange={(e) => onVersionFilterChange(e.target.value)}
          className="h-10 px-3 rounded-xl border border-outline bg-surface-muted text-[13px] font-bold text-content-secondary outline-none focus:border-blue-400"
        >
          <option value="all">{t("versionManagement.filters.allVersions")}</option>
          {visibleVersions.map((version) => (
            <option key={version} value={version}>{version}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="h-10 px-3 rounded-xl border border-outline bg-surface-muted text-[13px] font-bold text-content-secondary outline-none focus:border-blue-400"
        >
          <option value="all">{t("versionManagement.filters.allStatuses")}</option>
          <option value="latest">{t("versionManagement.status.latest")}</option>
          <option value="outdated">{t("versionManagement.status.outdated")}</option>
          <option value="success">{t("versionManagement.status.success")}</option>
          <option value="failed">{t("versionManagement.status.failed")}</option>
          <option value="rollback">{t("versionManagement.status.rollback")}</option>
        </select>
        <select
          value={systemTagFilter}
          onChange={(e) => onSystemTagFilterChange(e.target.value)}
          className="h-10 px-3 rounded-xl border border-outline bg-surface-muted text-[13px] font-bold text-content-secondary outline-none focus:border-blue-400"
        >
          <option value="all">{t("versionManagement.filters.allTags")}</option>
          {visibleSystemTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      </div>
    </Card>
  );
}
