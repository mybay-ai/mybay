import React, { useState } from "react";
import { LayoutGrid, List, Plus, Search, X, RefreshCw, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { AgentInstance, User as UserType } from "../../types";
import { Button, cn } from "../ui";
import { InstanceGrid } from "./InstanceGrid";
import { InstanceTable } from "./InstanceTable";
import { MobileInstanceList } from "./MobileInstanceList";
import { useNavigate } from "react-router-dom";
import { APP_ROUTES } from "../../constants/routes";
import { useTranslation } from "react-i18next";
import { ImportArchivePreviewModal } from "./ImportArchivePreviewModal";
import { useFeedback } from "../FeedbackProvider";

interface InstancesPanelProps {
  instances: AgentInstance[];
  loading: boolean;
  viewMode: 'grid' | 'table';
  setViewMode: (mode: 'grid' | 'table') => void;
  activeLogs: string | null;
  setActiveLogs: (id: string | null) => void;
  detailTab: 'logs' | 'files' | 'context' | 'diagnostics';
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
  handleOpenTerminalView: (instId: string, tab: 'logs' | 'files') => void;
  deletingIds: Set<string>;
  actioningIds: Set<string>;
  handleBulkDelete: (ids: string[], onProgress?: (current: number, total: number) => void) => Promise<{successCount: number, failedCount: number, skippedCount: number}>;
}

export function InstancesPanel({
  instances,
  loading,
  viewMode,
  setViewMode,
  activeLogs,
  setActiveLogs,
  detailTab,
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
  deletingIds,
  actioningIds,
  handleBulkDelete
}: InstancesPanelProps) {
  const navigate = useNavigate();
  const { t } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const effectiveDeletingIds = React.useMemo(() => {
    const next = new Set(deletingIds);
    for (const instance of instances) {
      const cleanupStatus = instance.cleanupStatus || "";
      if (instance.status === "deleting" || ["queued", "cleaning", "retry_wait"].includes(cleanupStatus)) next.add(instance.id);
    }
    return next;
  }, [deletingIds, instances]);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Pagination & Selection state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ current: 0, total: 0 });
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
    setSelectedInstanceIds(new Set());
  }, [searchQuery, statusFilter]);

  // Client-side multi-dimensional search & status filtering
  const filteredInstances = React.useMemo(() => {
    return instances.filter((inst) => {
      // 1. Search Query Match
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        inst.name.toLowerCase().includes(query) ||
        inst.id.toLowerCase().includes(query) ||
        (inst.owner && inst.owner.toLowerCase().includes(query)) ||
        (inst.resolved_version && inst.resolved_version.toLowerCase().includes(query)) ||
        (inst.agent_image_tag && inst.agent_image_tag.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      // 2. Status Match
      if (statusFilter === "all") return true;
      if (statusFilter === "archived") return !!inst.archived;
      
      // Non-archived status mappings
      if (statusFilter === "running") {
        return (
          !inst.archived &&
          ["running", "partial_running", "gateway_ready", "dashboard_ready"].includes(inst.status)
        );
      }
      if (statusFilter === "stopped") {
        return !inst.archived && ["stopped", "exited"].includes(inst.status);
      }
      if (statusFilter === "deploying") {
        return (
          !inst.archived &&
          ["deploying", "creating", "initializing", "gateway_starting", "container_starting"].includes(
            inst.status
          )
        );
      }
      if (statusFilter === "unhealthy") {
        return !inst.archived && ["unhealthy", "failed"].includes(inst.status);
      }
      return true;
    });
  }, [instances, searchQuery, statusFilter]);

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
  };

  const totalPages = Math.ceil(filteredInstances.length / pageSize) || 1;
  
  // Ensure currentPage is valid (e.g., if items are deleted)
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedInstances = React.useMemo(() => {
    return filteredInstances.slice(
      (Math.max(1, currentPage) - 1) * pageSize,
      Math.max(1, currentPage) * pageSize
    );
  }, [filteredInstances, currentPage]);

  const handleSelectInstance = React.useCallback((id: string, selected: boolean) => {
    setSelectedInstanceIds(prev => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleSelectAll = React.useCallback((selected: boolean) => {
    setSelectedInstanceIds(prev => {
      const newSet = new Set(prev);
      if (selected) {
        paginatedInstances.forEach(i => {
          if (!effectiveDeletingIds.has(i.id)) newSet.add(i.id);
        });
      } else {
        paginatedInstances.forEach(i => newSet.delete(i.id));
      }
      return newSet;
    });
  }, [paginatedInstances, effectiveDeletingIds]);

  const executeBulkDelete = async () => {
    const idsToDelete = Array.from(selectedInstanceIds);
    if (idsToDelete.length === 0) return;
    
    const skippedCountInitial = idsToDelete.filter(id => effectiveDeletingIds.has(id)).length;
    const executableCount = idsToDelete.length - skippedCountInitial;

    if (executableCount === 0) {
      showAlert({
        title: "删除失败",
        message: t("instances_bulk_delete_empty") || "所选实例正在删除中，无需重复操作。",
        type: "warning"
      });
      setSelectedInstanceIds(new Set());
      return;
    }
    
    const confirmMsg = skippedCountInitial > 0 
      ? t("instances_bulk_delete_confirm_skipped", { selected: idsToDelete.length, skipped: skippedCountInitial, executable: executableCount })
      : t("instances_bulk_delete_confirm", { count: idsToDelete.length });

    const confirmed = await showConfirm({
      title: "确认删除实例",
      message: confirmMsg || `确定要删除这 ${idsToDelete.length} 个实例吗？该操作不可逆！`,
      type: "danger",
      confirmText: "确定删除",
      cancelText: "取消"
    });

    if (!confirmed) {
      return;
    }

    setIsBulkDeleting(true);
    setBulkDeleteProgress({ current: 0, total: executableCount });
    const { successCount, failedCount, skippedCount: actionSkippedCount } = await handleBulkDelete(idsToDelete, (current, total) => {
      setBulkDeleteProgress({ current, total });
    });
    setIsBulkDeleting(false);
    setSelectedInstanceIds(new Set()); // clear selection

    if (failedCount > 0 || actionSkippedCount > 0) {
      showAlert({
        title: "删除失败",
        message: t("instances_bulk_delete_result", { successCount, failedCount, skippedCount: actionSkippedCount }),
        type: "warning"
      });
    } else {
      showToast(`已提交 ${successCount} 个实例的清理请求`, "success");
    }
  };

  const selectableInstances = paginatedInstances.filter(i => !effectiveDeletingIds.has(i.id));
  const allOnPageSelected = selectableInstances.length > 0 && selectableInstances.every(i => selectedInstanceIds.has(i.id));

  return (
    <div className="space-y-6">
      {/* Search and Action Control Bar */}
      {instances.length > 0 && (
        <div className="bg-surface-muted/50 border border-outline/50 p-2 rounded-xl shadow-xs transition-all">
          <div className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between">
            {/* Search Bar Block */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("search_placeholder")}
                className="w-full pl-8.5 pr-8 py-1.5 h-9 bg-surface border border-outline rounded-xl text-[12px] font-medium placeholder:text-content-muted focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-action transition-all text-content"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 bg-surface-muted hover:bg-outline text-content-muted rounded-full flex items-center justify-center transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>

            {/* Quick Filters Block */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Status Select Filter */}
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 bg-surface border border-outline text-[12px] font-medium text-content-secondary px-3 py-1 rounded-xl focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-action shadow-xs cursor-pointer transition-colors hover:bg-surface-muted"
                >
                  <option value="all">{t("filter_all")}</option>
                  <option value="running">{t("filter_running")}</option>
                  <option value="stopped">{t("filter_stopped")}</option>
                  <option value="deploying">{t("filter_deploying")}</option>
                  <option value="unhealthy">{t("filter_unhealthy")}</option>
                  <option value="archived">{t("filter_archived")}</option>
                </select>
              </div>

              {/* Bulk Actions */}
              {selectedInstanceIds.size > 0 && (
                <div className="flex items-center gap-2 mr-1">
                  <span className="text-[12px] font-medium text-content-muted hidden sm:inline">
                    {t("selected")} {selectedInstanceIds.size}
                  </span>
                  <Button
                    variant="outline"
                    onClick={executeBulkDelete}
                    disabled={isBulkDeleting}
                    className="h-9 px-2.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/45 transition-colors flex items-center gap-1.5 shadow-xs shrink-0 rounded-xl text-[13px] font-semibold"
                  >
                    <Trash2 className={cn("w-3.5 h-3.5", isBulkDeleting && "animate-pulse")} />
                    <span className="hidden sm:inline">
                      {isBulkDeleting ? t("instances_deleting_progress", { current: bulkDeleteProgress.current, total: bulkDeleteProgress.total }) : t("instances_bulk_delete_btn")}
                    </span>
                  </Button>
                </div>
              )}

              {/* View Switches */}
              <div className="flex items-center gap-0.5 bg-outline/40 p-0.5 rounded-xl border border-outline/50 h-9">
                <button
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    "p-1 rounded-md text-[13px] font-semibold transition-colors duration-150 cursor-pointer",
                    viewMode === 'grid'
                      ? "bg-surface shadow-xs text-content border border-outline/40"
                      : "text-content-muted hover:text-content-secondary"
                  )}
                  title={t("view_mode_grid")}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={cn(
                    "p-1 rounded-md text-[13px] font-semibold transition-colors duration-150 cursor-pointer",
                    viewMode === 'table'
                      ? "bg-surface shadow-xs text-content border border-outline/40"
                      : "text-content-muted hover:text-content-secondary"
                  )}
                  title={t("view_mode_table")}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Backup Archive Preview Button */}
              <Button
                variant="outline"
                onClick={() => setIsImportModalOpen(true)}
                className="h-9 px-2.5 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-400 rounded-xl text-[13px] font-semibold transition-colors flex items-center gap-1.5 active:scale-95 shadow-xs shrink-0"
                title={t("import_archive_preview_title")}
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{t("import_archive_preview_title")}</span>
              </Button>

              {/* Reload Action Button */}
              <Button
                variant="outline"
                onClick={() => fetchInstances()}
                disabled={loading}
                className="h-9 px-2.5 bg-surface border border-outline rounded-xl text-[13px] font-semibold text-content-secondary hover:bg-surface-muted transition-colors flex items-center gap-1.5 active:scale-95 shadow-xs shrink-0"
                title={t("reload_tooltip")}
              >
                <RefreshCw className={cn("w-3 h-3 text-content-muted", loading && "animate-spin")} />
                <span className="hidden sm:inline">{t("reload")}</span>
              </Button>

              {/* Count Indicator */}
              <div className="flex items-center gap-1.5 px-2.5 h-9 bg-outline/30 border border-outline/30 rounded-xl text-[13px] font-medium text-content-muted select-none shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {filteredInstances.length} / {instances.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse flex flex-col p-4 md:p-6 bg-surface rounded-2xl shadow-card border border-outline/50">
              <div className="flex justify-between items-start mb-4">
                <div className="flex gap-4">
                  <div className="w-1.5 h-12 bg-slate-200 rounded-full" />
                  <div className="space-y-3 py-1">
                    <div className="w-32 md:w-40 h-5 bg-slate-200 rounded-md" />
                    <div className="w-24 h-4 bg-slate-200 rounded-md" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-11 h-11 md:w-9 md:h-9 bg-slate-200 rounded-xl md:rounded-lg" />
                  <div className="w-11 h-11 md:w-9 md:h-9 bg-slate-200 rounded-xl md:rounded-lg" />
                </div>
              </div>
              <div className="w-full h-11 bg-slate-200 rounded-xl md:rounded-lg mb-4" />
              <div className="w-full h-10 bg-slate-200 rounded-xl md:rounded-lg" />
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 md:py-24 border border-dashed border-outline-strong rounded-3xl bg-surface shadow-sm px-6">
          <div className="w-16 h-16 bg-surface-muted rounded-full flex items-center justify-center mb-6">
            <Plus className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-content font-semibold text-xl md:text-2xl text-center mb-2">{t("empty_title")}</h3>
          <p className="text-content-muted text-[12px] md:text-[14px] text-center max-w-sm mb-8 leading-relaxed">
            {t("empty_description")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button 
              size="lg" 
              onClick={() => navigate(APP_ROUTES.DEPLOY)} 
              className="rounded-2xl font-semibold px-8 h-12 shadow-xl shadow-blue-500/10"
            >
              {t("empty_cta")}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setIsImportModalOpen(true)}
              className="rounded-2xl font-semibold px-6 h-12 border-outline text-content-secondary hover:bg-surface-muted flex items-center gap-2"
            >
              <Upload className="w-4 h-4 text-content-muted" />
              <span>{t("import_archive_preview_title")}</span>
            </Button>
          </div>
        </div>
      ) : filteredInstances.length === 0 ? (
        // Stateful empty/no-results state
        <div className="flex flex-col items-center justify-center py-12 md:py-16 border border-slate-150 rounded-3xl bg-surface shadow-sm px-6 text-center">
          <div className="w-12 h-12 bg-surface-muted border border-outline rounded-2xl flex items-center justify-center mb-4">
            <Search className="w-5 h-5 text-content-muted" />
          </div>
          <h3 className="text-content font-semibold text-base md:text-lg mb-1">{t("no_results_title")}</h3>
          <p className="text-content-muted text-[13px] md:text-[14px] max-w-md mb-6 leading-relaxed">
            {t("no_results_desc")}
          </p>
          <Button 
            variant="outline" 
            size="sm"
            onClick={clearFilters}
            className="rounded-xl font-semibold border-outline"
          >
            {t("clear_all_filters")}
          </Button>
        </div>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <InstanceGrid 
              instances={paginatedInstances}
              viewMode={viewMode}
              activeLogs={activeLogs}
              setActiveLogs={setActiveLogs}
              setDetailTab={setDetailTab}
              currentUser={currentUser}
              copiedId={copiedId}
              handleExportConfig={handleExportConfig}
              handleDelete={handleDelete}
              handleArchive={handleArchive}
              handleRestore={handleRestore}
              handleInstanceAction={handleInstanceAction}
              actioningIds={actioningIds}
              handleCopyUrl={handleCopyUrl}
              handleOpenLink={handleOpenLink}
              fetchInstances={fetchInstances}
              setEditingInstance={setEditingInstance}
              onRenameInstance={onRenameInstance}
              setMobileMenuOpenInstance={setMobileMenuOpenInstance}
              onViewGuide={onViewGuide}
              handleOpenTerminalView={handleOpenTerminalView}
              selectedInstanceIds={selectedInstanceIds}
              onSelectInstance={handleSelectInstance}
              deletingIds={effectiveDeletingIds}
              isMobile={isMobile}
            />
          ) : (
            <>
              {/* Mobile compact list */}
              {isMobile ? (
                <MobileInstanceList 
                  instances={paginatedInstances}
                  setActiveLogs={setActiveLogs}
                  setDetailTab={setDetailTab}
                  setMobileMenuOpenInstance={setMobileMenuOpenInstance}
                  currentUser={currentUser}
                  handleCopyUrl={handleCopyUrl}
                  handleOpenLink={handleOpenLink}
                  copiedId={copiedId}
                  fetchInstances={fetchInstances}
                  setEditingInstance={setEditingInstance}
                  onRenameInstance={onRenameInstance}
                  onViewGuide={onViewGuide}
                  handleOpenTerminalView={handleOpenTerminalView}
                  isMobile={isMobile}
                />
              ) : (
                /* Desktop detailed table */
                <InstanceTable 
                  instances={paginatedInstances}
                  viewMode={viewMode}
                  activeLogs={activeLogs}
                  setActiveLogs={setActiveLogs}
                  setDetailTab={setDetailTab}
                  currentUser={currentUser}
                  handleExportConfig={handleExportConfig}
                  handleDelete={handleDelete}
                  handleArchive={handleArchive}
                  handleRestore={handleRestore}
                  handleInstanceAction={handleInstanceAction}
                  actioningIds={actioningIds}
                  handleOpenLink={handleOpenLink}
                  fetchInstances={fetchInstances}
                  setEditingInstance={setEditingInstance}
                  onRenameInstance={onRenameInstance}
                  onViewGuide={onViewGuide}
                  handleOpenTerminalView={handleOpenTerminalView}
                  selectedInstanceIds={selectedInstanceIds}
                  onSelectInstance={handleSelectInstance}
                  onSelectAll={handleSelectAll}
                  allSelected={allOnPageSelected}
                  deletingIds={effectiveDeletingIds}
                  isMobile={isMobile}
                />
              )}
            </>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 bg-surface p-3 rounded-xl border border-outline/60 shadow-sm">
              <span className="text-[13px] text-content-muted font-semibold">
                {t("pagination_info", { start: (currentPage - 1) * pageSize + 1, end: Math.min(currentPage * pageSize, filteredInstances.length), total: filteredInstances.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-2 text-[13px] font-semibold"
                >
                  {t("pagination_prev")}
                </Button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    className={cn(
                      "w-8 h-8 rounded-xl text-[13px] font-semibold transition-colors",
                      currentPage === i + 1 ? "bg-slate-800 text-white" : "text-content-secondary hover:bg-surface-muted"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-2 text-[13px] font-semibold"
                >
                  {t("pagination_next")}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {isImportModalOpen && (
        <ImportArchivePreviewModal 
          onClose={() => setIsImportModalOpen(false)} 
          onRefresh={fetchInstances}
        />
      )}
    </div>
  );
}
