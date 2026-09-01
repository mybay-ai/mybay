import React, { useState, useEffect, useMemo, useRef } from "react";
import { Folder, ChevronRight, Download, Eye, ArrowLeft, RefreshCw, AlertCircle, FileText, ImageIcon, FileCode, Search, X, Trash2, HardDrive, PieChart, Sparkles, CheckSquare, Clock3, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./ui";
import { useFeedback } from "./FeedbackProvider";

import { api } from "../lib/api";
import { InstanceFilePreview } from "./InstanceFilePreview";
import { InstanceFileUpload } from "./InstanceFileUpload";
import { createInstanceFileRequestScope, prepareInstanceFileDownload, filterInstanceFiles, type InstanceFileItem as FileItem, type InstanceFileFilter, type InstanceFileSort } from "../lib/instanceFiles";




type FileUsageCategory = "document" | "spreadsheet" | "image" | "web" | "log" | "archive" | "cache" | "other";

type FileUsageReasonCode = "large_file" | "old_file" | "cache_or_log" | "generated_output";

interface FileUsageEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  updatedAt: string;
  category: FileUsageCategory;
  deletable: boolean;
  reasonCode?: FileUsageReasonCode;
}

interface FileUsageAnalysis {
  totalBytes: number;
  scannedFiles: number;
  truncated: boolean;
  folders: FileUsageEntry[];
  topFiles: FileUsageEntry[];
  recentFiles?: FileUsageEntry[];
  recommendations: FileUsageEntry[];
  categories: { category: FileUsageCategory; size: number }[];
  quota?: {
    storageUsedBytes?: number | null;
    storageLimitBytes?: number | null;
    storageUsagePercent?: number | null;
    storageStatus?: string;
    storageExceeded?: boolean;
  };
}

interface InstanceFilesSectionProps {
  instanceId: string;
  currentUser: any;
}

type FileSelectionCandidate = Pick<FileItem, "type" | "name" | "path" | "isSymlink">;

export function isFileSelectableForDeletion(item: FileSelectionCandidate): boolean {
  if (item.type === "directory" || item.isSymlink || item.name.startsWith(".")) return false;
  const normalizedName = item.name.toLowerCase();
  const sensitiveNames = [
    "config.yaml",
    "mybay.instance.yaml",
    "mybay.system.md",
    "mybay.template.yaml",
    "credentials",
    "secrets"
  ];
  if (sensitiveNames.includes(normalizedName)) return false;
  if (normalizedName.endsWith(".key") || normalizedName.endsWith(".pem")) return false;

  const normalizedPath = item.path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return ["outputs/", "uploads/", "documents/", "reports/", "tmp/"].some((prefix) =>
    normalizedPath.startsWith(prefix)
  );
}

export async function getFileDownloadBlob(response: Response): Promise<Blob> {
  return response.blob();
}

type PreviewResolution =
  | { kind: "image"; mime: string; blob: Blob }
  | { kind: "text"; mime: string; content: string };

export async function resolvePreviewResponse(
  response: Response | { content?: string; mime?: string },
  fallbackMime = ""
): Promise<PreviewResolution> {
  if (response instanceof Response) {
    const mime = (response.headers.get("Content-Type") || fallbackMime).split(";", 1)[0].trim();
    if (mime.startsWith("image/")) return { kind: "image", mime, blob: await response.blob() };
    return { kind: "text", mime: mime || "text/plain", content: await response.text() };
  }

  return {
    kind: "text",
    mime: response.mime || fallbackMime || "text/plain",
    content: response.content || ""
  };
}

export function InstanceFilesSection(props: InstanceFilesSectionProps) {
  // Both the file center and the instance detail panel use this boundary.
  return <InstanceFilesContent key={props.instanceId} {...props} />;
}

function InstanceFilesContent({ instanceId }: InstanceFilesSectionProps) {
  const { t } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [currentPath, setCurrentPath] = useState("/");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<FileUsageAnalysis | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const mutationLock = useRef(false);
  const requests = useRef(createInstanceFileRequestScope());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<InstanceFileFilter>("all");
  const [sort, setSort] = useState<InstanceFileSort>("name");
  const visibleItems = useMemo(() => filterInstanceFiles(items, search, typeFilter, sort), [items, search, typeFilter, sort]);

  const closePreview = () => {
    setPreviewFile(null);
  };



  const fetchUsage = async () => {
    const request = requests.current.begin("usage");
    setUsageLoading(true);
    setUsageError(null);
    try {
      const data = await api.get("/api/instances/" + encodeURIComponent(instanceId) + "/files/usage", { signal: request.signal });
      if (!request.isCurrent()) return;
      setUsage(data || null);
    } catch (err: any) {
      if (!request.isCurrent()) return;
      setUsage(null);
      setUsageError(err.message || t("files_network_failed"));
    } finally {
      if (request.isCurrent()) setUsageLoading(false);
    }
  };

  const fetchFiles = async (path: string) => {
    requests.current.advanceContext();
    const request = requests.current.begin("list");
    closePreview();
    requests.current.cancel("download");
    setLoading(true);
    setError(null);
    setCurrentPath(path);
    setItems([]);
    setSelectedFiles(new Set());
    try {
      const data = await api.get(`/api/instances/${instanceId}/files?path=${encodeURIComponent(path)}`, { signal: request.signal });
      if (!request.isCurrent()) return;
      if (data) {
        setItems(data.items);
        setCurrentPath(data.path);
      } else {
        setError(t("files_fetch_failed"));
      }
    } catch (err: any) {
      if (!request.isCurrent()) return;
      setError(err.message || t("files_network_failed"));
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    const scope = createInstanceFileRequestScope();
    requests.current = scope;
    fetchFiles("/");
    fetchUsage();
    return () => { scope.dispose(); };
  }, [instanceId]);

  const handleNavigate = (path: string) => {
    if (mutationLock.current) return;
    setSearch("");
    setTypeFilter("all");
    fetchFiles(path);
  };

  const handleBack = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    handleNavigate("/" + parts.join("/"));
  };

  const isFileSelectable = (item: FileItem) => {
    return isFileSelectableForDeletion(item);
  };

  const toggleFileSelection = (item: FileItem) => {
    if (!isFileSelectable(item)) return;
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(item.path)) {
      newSelected.delete(item.path);
    } else {
      newSelected.add(item.path);
    }
    setSelectedFiles(newSelected);
  };

  const MAX_BULK_DELETE = 50;

  const handleSelectAll = () => {
    const selectable = visibleItems.filter(isFileSelectable);
    if (selectable.length === 0) return;

    const allCurrentlySelected = selectable.every(i => selectedFiles.has(i.path));

    if (allCurrentlySelected) {
      setSelectedFiles(new Set());
    } else {
      if (selectable.length > MAX_BULK_DELETE) {
        showAlert({
          title: t("files_select_limited_title"),
          message: t("files_bulk_limit_msg", { count: selectable.length, max: MAX_BULK_DELETE }),
          type: "warning"
        });
        setSelectedFiles(new Set(selectable.slice(0, MAX_BULK_DELETE).map(i => i.path)));
      } else {
        setSelectedFiles(new Set(selectable.map(i => i.path)));
      }
    }
  };



  const handleSelectRecommended = () => {
    const paths = (usage?.recommendations || [])
      .filter(item => item.deletable)
      .slice(0, MAX_BULK_DELETE)
      .map(item => item.path);
    setSelectedFiles(new Set(paths));
  };

  const executeBulkDelete = async (paths: string[]) => {
    if (mutationLock.current) return;
    if (paths.length === 0) return;
    if (paths.length > MAX_BULK_DELETE) {
      showAlert({
        title: t("files_action_limited_title"),
        message: t("files_bulk_max_limit", { max: MAX_BULK_DELETE }),
        type: "error"
      });
      return;
    }

    const isCurrent = requests.current.captureContext();
    const mutation = requests.current.begin("mutation");
    mutationLock.current = true;
    setMutating(true);
    try {
      const data = await api.post(`/api/instances/${instanceId}/files/bulk-delete`, { paths });
      if (!isCurrent()) return;

      if (data) {
        let msg = t("files_bulk_delete_success", { count: data.deleted?.length || 0 });
        if (data.failed && data.failed.length > 0) {
          msg += t("files_bulk_delete_partial_failed", { count: data.failed.length });
          console.warn("[Bulk Delete] Some files failed:", data.failed);
        }
        showAlert({
          title: t("files_bulk_delete_done_title"),
          message: msg,
          type: (data.failed && data.failed.length > 0) ? "warning" : "success"
        });

        setSelectedFiles(new Set());
        fetchFiles(currentPath);
        fetchUsage();
        window.dispatchEvent(new CustomEvent('mybay:stats-refresh', { detail: { instanceId } }));
      } else {
        showAlert({
          title: t("files_delete_failed_title"),
          message: t("files_bulk_delete_failed"),
          type: "error"
        });
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      showAlert({
        title: t("files_delete_failed_title"),
        message: t("files_bulk_delete_error", { message: err.message }),
        type: "error"
      });
    } finally {
      mutationLock.current = false;
      if (mutation.isCurrent()) setMutating(false);
    }
  };

  const handleBulkDelete = async () => {
    const isCurrent = requests.current.captureContext();
    const paths = Array.from(selectedFiles);
    if (paths.length === 0) return;
    const confirmed = await showConfirm({
      title: t("files_bulk_delete_confirm_title"),
      message: t("files_bulk_delete_confirm", { count: paths.length }),
      type: "danger",
      confirmText: t("files_bulk_delete_confirm_text"),
      cancelText: t("action_cancel")
    });
    if (!confirmed || !isCurrent()) return;
    await executeBulkDelete(paths);
  };

  const handleCleanupRecommended = async () => {
    const isCurrent = requests.current.captureContext();
    const paths = (usage?.recommendations || [])
      .filter(item => item.deletable)
      .slice(0, MAX_BULK_DELETE)
      .map(item => item.path);
    if (paths.length === 0) return;

    const confirmed = await showConfirm({
      title: t("files_cleanup_now_confirm_title"),
      message: t("files_cleanup_now_confirm", { count: paths.length }),
      type: "danger",
      confirmText: t("files_cleanup_now"),
      cancelText: t("action_cancel")
    });
    if (!confirmed || !isCurrent()) return;
    await executeBulkDelete(paths);
  };

  const handleDelete = async (item: FileItem) => {
    const isCurrent = requests.current.captureContext();
    const confirmed = await showConfirm({
      title: t("files_delete_confirm_title"),
      message: t("files_delete_confirm", { name: item.name }),
      type: "danger",
      confirmText: t("files_delete_confirm_text"),
      cancelText: t("action_cancel")
    });
    if (!confirmed || !isCurrent() || mutationLock.current) return;

    const mutation = requests.current.begin("mutation");
    mutationLock.current = true;
    setMutating(true);
    try {
      const data = await api.delete(`/api/instances/${instanceId}/files?path=${encodeURIComponent(item.path)}`, {
        path: item.path
      });
      if (!isCurrent()) return;
      if (data) {
        showToast(t("files_delete_success"), "success");
        fetchFiles(currentPath);
        fetchUsage();
        // Dispatch custom event to trigger stats refresh
        window.dispatchEvent(new CustomEvent('mybay:stats-refresh', { detail: { instanceId } }));
      } else {
        showAlert({
          title: t("files_delete_failed_title"),
          message: t("files_delete_failed"),
          type: "error"
        });
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      showAlert({
        title: t("files_delete_failed_title"),
        message: t("files_delete_error", { message: err.message }),
        type: "error"
      });
    } finally {
      mutationLock.current = false;
      if (mutation.isCurrent()) setMutating(false);
    }
  };

  const handleDownload = async (item: FileItem) => {
    const request = requests.current.begin("download");
    try {
      const downloadUrl = await prepareInstanceFileDownload(instanceId, item.path, request.signal);
      if (!request.isCurrent()) return;

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = item.name;
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
      }
      showToast(t("files_download_started"), "success");
    } catch (err: any) {
      if (!request.isCurrent()) return;
      showAlert({
        title: t("files_download_failed_title"),
        message: t("files_download_failed_message"),
        type: "error",
        details: err.message || t("files_download_error")
      });
    }
  };

  const handlePreview = (item: FileItem) => setPreviewFile(item);

  const getFileIcon = (item: FileItem) => {
    if (item.type === "directory") return <Folder className="w-4 h-4 text-sky-500 fill-sky-100/50" />;
    const mime = item.mime || "";
    if (mime.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-purple-500" />;
    if (mime.includes("json") || mime.includes("yaml") || mime.includes("code")) return <FileCode className="w-4 h-4 text-amber-500" />;
    return <FileText className="w-4 h-4 text-content-muted" />;
  };

  const formatSize = (bytes: number | null) => {
    if (bytes === null) return "";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-surface text-content font-sans relative overflow-hidden min-h-[500px]">
      {/* File Browser Header */}
      <div className="px-3 sm:px-5 py-3 border-b border-outline/60 flex flex-wrap gap-3 items-center justify-between shrink-0 bg-surface-muted/20">
        <div className="flex items-center gap-3 overflow-hidden">
          <button
            className="h-8 w-8 rounded-lg flex items-center justify-center text-content-muted hover:text-content hover:bg-control-hover/60 transition-colors disabled:opacity-30 disabled:pointer-events-none border border-outline/50 bg-surface"
            onClick={handleBack}
            disabled={currentPath === "/" || loading || mutating || !!previewFile}
            aria-label={t("files_back")}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <nav className="flex items-center text-xs font-medium overflow-hidden">
            <button
              className={cn("hover:text-content transition-colors whitespace-nowrap", currentPath === "/" ? "text-content font-semibold" : "text-content-muted")}
              onClick={() => !previewFile && handleNavigate("/")}
            >
              {t("files_workspace")}
            </button>
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight className="w-3.5 h-3.5 mx-1.5 text-slate-300 shrink-0" />
                <button
                  className={cn(
                    "hover:text-content transition-colors truncate max-w-[120px]",
                    idx === breadcrumbs.length - 1 ? "text-content font-semibold" : "text-content-muted"
                  )}
                  onClick={() => !previewFile && handleNavigate("/" + breadcrumbs.slice(0, idx + 1).join("/"))}
                >
                  {crumb}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end">
          {selectedFiles.size > 0 && (
            <div className="flex items-center text-xs font-medium text-content-secondary bg-surface-muted px-2.5 py-1 rounded-lg border border-outline w-full sm:w-auto justify-between sm:justify-start order-2 sm:order-1 mt-1 sm:mt-0 shadow-2xs">
               <div className="flex items-center truncate">
                 {t("files_selected_count", { count: selectedFiles.size })}
                 {selectedFiles.size > MAX_BULK_DELETE && (
                   <span className="text-[10px] text-amber-600/80 ml-1 hidden xs:inline">{t("files_bulk_limit_hint", { max: MAX_BULK_DELETE })}</span>
                 )}
               </div>
               <div className="flex items-center gap-1.5 ml-3 shrink-0">
                 <button
                   className="text-content-muted hover:text-content-secondary text-xs font-medium px-2 py-0.5 rounded-md"
                   onClick={() => setSelectedFiles(new Set())}
                   disabled={loading || mutating}
                 >
                   {t("action_cancel")}
                 </button>
                 <button
                   className={cn(
                     "h-7 px-2.5 font-semibold rounded-md border text-xs transition-all flex items-center justify-center gap-1",
                     selectedFiles.size > MAX_BULK_DELETE
                       ? "bg-surface-muted border-outline text-content-muted cursor-not-allowed opacity-50"
                       : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100/60"
                   )}
                   onClick={handleBulkDelete}
                   disabled={loading || mutating || selectedFiles.size > MAX_BULK_DELETE}
                 >
                   {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3.5 h-3.5"/>}
                   {t("files_bulk_delete_btn")}
                 </button>
               </div>
            </div>
          )}
          <div className="flex items-center order-1 sm:order-2 ml-auto">
            <button
              className="h-8 w-8 rounded-lg border border-outline/60 bg-surface flex items-center justify-center text-content-muted hover:text-content hover:bg-surface-muted transition-colors shadow-2xs"
              onClick={() => fetchFiles(currentPath)}
              disabled={loading || mutating || !!previewFile}
              aria-label={t("files_refresh")}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      <InstanceFileUpload instanceId={instanceId} directory={currentPath} disabled={loading || mutating || !!previewFile}
        onOpenDirectory={handleNavigate}
        onUploaded={directory => { if (directory === currentPath) { setSearch(""); setTypeFilter("all"); } if (!previewFile) void fetchFiles(currentPath); void fetchUsage(); }} />
      <div className="flex flex-wrap items-center gap-2 border-b border-outline px-3 sm:px-5 py-3">
        <label className="relative min-w-0 w-full sm:flex-1 sm:w-auto">
          <Search className="absolute left-3 top-3 h-4 w-4 text-content-muted" />
          <input value={search} onChange={event => { setSearch(event.target.value); setSelectedFiles(new Set()); }}
            aria-label={t("files_search_current")} placeholder={t("files_search_current")}
            className="h-10 w-full rounded-lg border border-outline bg-control pl-9 pr-3 text-xs text-content" />
        </label>
        <select value={typeFilter} onChange={event => { setTypeFilter(event.target.value as InstanceFileFilter); setSelectedFiles(new Set()); }}
          aria-label={t("files_filter_type")} className="h-10 min-w-0 flex-1 sm:flex-none rounded-lg border border-outline bg-control px-2 text-xs text-content">
          {(["all", "document", "image", "code", "other"] as const).map(value => <option key={value} value={value}>{t("files_filter_" + value)}</option>)}
        </select>
        <select value={sort} onChange={event => setSort(event.target.value as InstanceFileSort)}
          aria-label={t("files_sort")} className="h-10 min-w-0 flex-1 sm:flex-none rounded-lg border border-outline bg-control px-2 text-xs text-content">
          {(["name", "size", "updated"] as const).map(value => <option key={value} value={value}>{t("files_sort_" + value)}</option>)}
        </select>
        <p className="w-full text-[11px] text-content-muted" aria-live="polite">{t("files_visible_count", { shown: visibleItems.length, total: items.length })}</p>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto min-h-0">

        <InstanceUsagePanel
          usage={usage}
          loading={usageLoading}
          error={usageError}
          busy={mutating || loading}
          formatSize={formatSize}
          onRefresh={fetchUsage}
          onSelectRecommended={handleSelectRecommended}
          onCleanupRecommended={handleCleanupRecommended}
        />
        {loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-20">
            <RefreshCw className="w-8 h-8 text-slate-300 animate-spin" />
            <p className="text-xs text-content-muted">{t("files_scanning_dir")}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-16 px-6 text-center">
            <AlertCircle className="w-10 h-10 text-slate-300" />
            <div className="space-y-1">
              <h3 className="text-content font-semibold text-sm">{t("files_cannot_access_dir")}</h3>
              <p className="text-xs text-content-muted leading-relaxed max-w-sm">
                {error}. <br/>
                {t("files_cannot_access_desc")}
              </p>
            </div>
            <button
              className="px-3.5 py-1.5 rounded-lg border border-outline text-content-secondary hover:bg-surface-muted text-xs font-semibold shadow-2xs"
              onClick={() => handleNavigate("/")}
            >
              {t("files_back_to_root")}
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-24 text-content-muted gap-2">
            <Search className="w-8 h-8 opacity-40 animate-pulse" />
            <p className="text-xs font-medium">{t(items.length ? "files_no_matches" : "files_dir_empty")}</p>
            {(search || typeFilter !== "all") && <button className="min-h-11 px-3 text-xs text-indigo-500" onClick={() => { setSearch(""); setTypeFilter("all"); setSelectedFiles(new Set()); }}>{t("files_clear_filters")}</button>}
          </div>
        ) : (
          <div className="divide-y divide-outline">
            {/* Header row for select all */}
            {visibleItems.some(isFileSelectable) && (
              <div className="flex items-center px-5 py-2.5 bg-surface-muted/50 border-b border-outline/50">
                 <input
                   type="checkbox"
                   className="w-3.5 h-3.5 rounded border-outline-strong text-indigo-600 focus:ring-indigo-500 mr-3 cursor-pointer"
                   checked={visibleItems.filter(isFileSelectable).length > 0 && visibleItems.filter(isFileSelectable).every(i => selectedFiles.has(i.path))}
                   disabled={mutating}
                   onChange={handleSelectAll}
                   title={t("files_select_all_title")}
                 />
                 <span className="text-[11px] text-content-muted font-semibold uppercase tracking-wider">{t("files_select_all_label")}</span>
              </div>
            )}
            {visibleItems.map((item) => {
              const selectable = isFileSelectable(item);
              const isSelected = selectedFiles.has(item.path);
              return (
              <div
                key={item.path}
                className={cn(
                  "group flex flex-wrap items-center justify-between px-3 sm:px-5 py-3 hover:bg-surface-muted/50 transition-colors border-l-2",
                  "cursor-pointer",
                  isSelected ? "bg-indigo-50/15 border-l-indigo-500" : "border-l-transparent"
                )}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button,input,label")) return;
                  if (mutationLock.current) return;
                  if (item.type === "directory") {
                    handleNavigate(item.path);
                  } else {
                    handlePreview(item);
                  }
                }}
              >
                <div className="flex items-center gap-3 min-w-0 w-full md:w-auto md:flex-1">
                  {selectable ? (
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-outline-strong text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                      checked={isSelected}
                      disabled={mutating}
                      aria-label={t("files_select_named", { name: item.name })}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleFileSelection(item)}
                    />
                  ) : (
                    <div className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <div className="shrink-0">{getFileIcon(item)}</div>
                  <div className="min-w-0 flex-1 pr-2">
                    <button className="block max-w-full text-left text-xs font-semibold text-content-secondary truncate group-hover:text-content transition-colors" title={item.name}
                      disabled={mutating} onClick={() => item.type === "directory" ? handleNavigate(item.path) : handlePreview(item)}>
                      {item.name}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
                      <span className="text-[10px] text-content-muted font-mono">
                        {item.type === "directory" ? t("files_directory_type") : formatSize(item.size)}
                      </span>
                      <span className="text-[10px] text-content-muted font-mono">
                        {new Date(item.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex w-full md:w-auto justify-end shrink-0 items-center gap-1 mt-2 md:mt-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <button className="h-11 w-11 md:h-8 md:w-8 rounded-md border border-outline/50 flex items-center justify-center text-content-muted hover:bg-control-hover bg-surface"
                    title={t("files_copy_path")} aria-label={t("files_copy_path")}
                    onClick={async () => {
                      const isCurrent = requests.current.captureContext();
                      try { await navigator.clipboard.writeText(item.path); if (isCurrent()) showToast(t("files_path_copied"), "success"); }
                      catch { if (isCurrent()) showAlert({ title: t("files_copy_path"), message: t("files_copy_failed"), details: item.path, type: "warning" }); }
                    }}><Copy className="w-3.5 h-3.5" /></button>
                  {item.type === "file" && (
                    <>
                      <button
                        className="h-11 w-11 md:h-8 md:w-8 rounded-md border border-outline/50 flex items-center justify-center text-content-muted hover:text-content-secondary hover:bg-control-hover bg-surface shadow-3xs"
                        onClick={(e) => { e.stopPropagation(); handlePreview(item); }}
                        title={t("files_preview_title")}
                        aria-label={t("files_preview_title")}
                        disabled={mutating}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        className="h-11 w-11 md:h-8 md:w-8 rounded-md border border-outline/50 flex items-center justify-center text-content-muted hover:text-content-secondary hover:bg-control-hover bg-surface shadow-3xs"
                        onClick={(e) => { e.stopPropagation(); handleDownload(item); }}
                        title={t("files_download_title")}
                        aria-label={t("files_download_title")}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {selectable && (
                        <button
                          className="h-11 w-11 md:h-8 md:w-8 rounded-md border border-outline/50 flex items-center justify-center text-content-muted hover:text-rose-600 hover:bg-rose-50 bg-surface shadow-3xs"
                          onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                          title={t("files_delete_title")}
                          aria-label={t("files_delete_title")}
                          disabled={mutating}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                  {item.type === "directory" && (
                    <button
                      className="h-11 w-11 md:h-8 md:w-8 rounded-md border border-outline/50 flex items-center justify-center text-content-muted hover:text-content-secondary hover:bg-control-hover bg-surface shadow-3xs"
                      onClick={(e) => { e.stopPropagation(); handleNavigate(item.path); }}
                      aria-label={t("files_open_folder")}
                      disabled={mutating}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      <div className="px-5 py-2.5 border-t border-outline/60 bg-surface-muted/30 shrink-0">
        <p className="text-[10px] text-content-muted font-mono font-medium">
          {t("files_mode_footer_desc")}
        </p>
      </div>

      {previewFile && <InstanceFilePreview
        key={previewFile.path}
        instanceId={instanceId}
        file={previewFile}
        onClose={closePreview}
        onDownload={() => handleDownload(previewFile)}
      />}

    </div>
  );
}


function InstanceUsagePanel({
  usage,
  loading,
  error,
  busy,
  formatSize,
  onRefresh,
  onSelectRecommended,
  onCleanupRecommended
}: {
  usage: FileUsageAnalysis | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  formatSize: (bytes: number | null) => string;
  onRefresh: () => void;
  onSelectRecommended: () => void;
  onCleanupRecommended: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const usedBytes = usage?.quota?.storageUsedBytes ?? usage?.totalBytes ?? null;
  const limitBytes = usage?.quota?.storageLimitBytes ?? null;
  const percent = typeof usage?.quota?.storageUsagePercent === "number"
    ? Math.max(0, Math.min(999, usage.quota.storageUsagePercent))
    : usedBytes !== null && limitBytes ? Math.round((usedBytes / limitBytes) * 1000) / 10 : null;
  const barPercent = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const recommendedBytes = (usage?.recommendations || []).reduce((sum, item) => sum + item.size, 0);
  const hasUsage = !!usage;

  const renderEntry = (entry: FileUsageEntry) => (
    <div key={entry.path} className="flex items-center justify-between gap-3 rounded-lg border border-outline/70 bg-surface px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-content-secondary" title={entry.path}>{entry.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-content-muted font-mono" title={entry.path}>{entry.path}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-bold text-content-secondary">{formatSize(entry.size)}</p>
        {entry.reasonCode && <p className="text-[10px] text-amber-600">{t("files_usage_reason_" + entry.reasonCode)}</p>}
      </div>
    </div>
  );

  return (
    <div className="border-b border-outline/60 bg-surface-muted/30 p-4 sm:p-5">
      <div className="rounded-xl border border-outline bg-surface shadow-2xs overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-outline px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-content">{t("files_usage_title")}</h3>
              <p className="text-xs text-content-muted" aria-live="polite">{loading ? t("files_usage_loading") : error ? t("files_usage_failed") : hasUsage ? `${formatSize(usedBytes)} · ${t("files_usage_scanned", { count: usage.scannedFiles })}` : t("files_usage_desc")}</p>
              {usage?.truncated && <p className="text-xs text-amber-600">{t("files_usage_truncated")}</p>}
            </div>
          </div>
          <button
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-outline bg-surface px-3 text-xs font-semibold text-content-secondary hover:bg-surface-muted disabled:opacity-50"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("files_usage_refresh")}
          </button>
        </div>

        {error && <p role="alert" className="px-4 py-3 text-xs text-amber-600">{error}</p>}
        <details>
        <summary className="cursor-pointer px-4 py-3 min-h-11 text-xs font-semibold text-content-secondary">{t("files_usage_details")}</summary>
        <div className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-xl border border-outline bg-surface-muted/70 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("files_usage_total")}</p>
                <p className="mt-1 text-xl font-bold text-content">{usedBytes === null ? t("files_usage_percent_unknown") : formatSize(usedBytes)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("files_usage_limit")}</p>
                <p className="mt-1 text-sm font-bold text-content-secondary">{!hasUsage ? t("files_usage_percent_unknown") : limitBytes ? formatSize(limitBytes) : t("files_usage_unlimited")}</p>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn("h-full rounded-full transition-all", (percent ?? 0) >= 95 ? "bg-rose-500" : (percent ?? 0) >= 80 ? "bg-amber-500" : "bg-indigo-500")}
                style={{ width: barPercent + "%" }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-content-muted">
              <span>{percent === null ? t("files_usage_percent_unknown") : t("files_usage_percent", { percent })}</span>
              {usage?.truncated && <span className="text-amber-600">{t("files_usage_truncated")}</span>}
            </div>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-content">{t("files_cleanup_title")}</p>
                  <p className="mt-1 text-xs leading-relaxed text-content-muted">
                    {!hasUsage ? t("files_usage_percent_unknown") : usage?.recommendations?.length
                      ? t("files_cleanup_desc", { count: usage.recommendations.length, size: formatSize(recommendedBytes) })
                      : t("files_cleanup_empty")}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-surface px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  onClick={onSelectRecommended}
                  disabled={loading || busy || !usage?.recommendations?.length}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {t("files_cleanup_select")}
                </button>
                <button
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-surface px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  onClick={onCleanupRecommended}
                  disabled={loading || busy || !usage?.recommendations?.length}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("files_cleanup_now")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {hasUsage && (
          <div className="grid gap-3 border-t border-outline p-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-content-secondary"><PieChart className="h-3.5 w-3.5" />{t("files_usage_folders")}</div>
              {(usage.folders || []).slice(0, 4).map(renderEntry)}
              {usage.folders.length === 0 && <p className="rounded-lg bg-surface-muted px-3 py-3 text-xs text-content-muted">{t("files_usage_no_data")}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-content-secondary"><FileText className="h-3.5 w-3.5" />{t("files_usage_top_files")}</div>
              {(usage.topFiles || []).slice(0, 4).map(renderEntry)}
              {usage.topFiles.length === 0 && <p className="rounded-lg bg-surface-muted px-3 py-3 text-xs text-content-muted">{t("files_usage_no_data")}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-content-secondary"><Clock3 className="h-3.5 w-3.5" />{t("files_usage_recent_files")}</div>
              {(usage.recentFiles || []).slice(0, 4).map(renderEntry)}
              {(usage.recentFiles || []).length === 0 && <p className="rounded-lg bg-surface-muted px-3 py-3 text-xs text-content-muted">{t("files_usage_no_data")}</p>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-content-secondary"><Sparkles className="h-3.5 w-3.5" />{t("files_usage_recommended")}</div>
              {(usage.recommendations || []).slice(0, 4).map(renderEntry)}
              {usage.recommendations.length === 0 && <p className="rounded-lg bg-surface-muted px-3 py-3 text-xs text-content-muted">{t("files_usage_no_recommendations")}</p>}
            </div>
          </div>
        )}
        </details>
      </div>
    </div>
  );
}

function FileDescriptionIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <ImageIcon className="w-4 h-4 text-purple-400" />;
  if (mime.includes("json") || mime.includes("yaml") || mime.includes("code")) return <FileCode className="w-4 h-4 text-amber-400" />;
  return <FileText className="w-4 h-4 text-content-muted" />;
}
