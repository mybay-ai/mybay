import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInstance, User } from "../../types";
import { api, ApiError } from "../../lib/api";
import { getAuthToken } from "../../lib/auth";
import { useFeedback } from "../FeedbackProvider";
import { recentActions } from "../../lib/recentActions";

export function useInstanceActions(fetchInstances: () => void, currentUser: User | null) {
  const { t } = useTranslation("dashboard");
  const { showAlert, showConfirm, showToast } = useFeedback();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set());
  const actioningIdsRef = React.useRef<Set<string>>(new Set());

  const handleInstanceAction = async (id: string, action: string, requireConfirm: boolean = false, confirmMsg: string = "") => {
    if (actioningIdsRef.current.has(id)) return;
    if (requireConfirm) {
      const confirmed = await showConfirm({
        title: t("instanceActions.operationConfirm"),
        message: confirmMsg,
        type: "warning"
      });
      if (!confirmed) return;
    }
    if (actioningIdsRef.current.has(id)) return;
    actioningIdsRef.current.add(id);
    setActioningIds(prev => new Set(prev).add(id));
    try {
      await api.post(`/api/instances/${id}/action`, { action });
      showToast(t("instanceActions.actionSubmitted"), "success");
      fetchInstances();
    } catch (err) {
      console.error("Instance action failed:", err);
      const details = (err as any)?.data?.message || (err as any)?.message || "";
      showAlert({
        title: t("instanceActions.actionFailedTitle"),
        message: t("instanceActions.actionFailedMessage"),
        type: "error",
        details
      });
    } finally {
      actioningIdsRef.current.delete(id);
      setActioningIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleRecheckHealth = async (id: string) => {
    try {
      await api.post(`/api/instances/${id}/health-check`);
      fetchInstances();
    } catch (err) {
      console.error("Health check failed:", err);
    }
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (deletingIds.has(id)) return;
    const confirmed = await showConfirm({
      title: t("instanceActions.delete.title"),
      message: t("action_delete_confirm"),
      type: "danger",
      confirmText: t("instanceActions.delete.confirm"),
      cancelText: t("action_cancel")
    });
    if (confirmed) {
      setDeletingIds(prev => new Set(prev).add(id));
      try {
        await api.delete(`/api/instances/${id}`);
        fetchInstances();
        showToast(t("instanceActions.delete.submitted"), "success");
      } catch (err: any) {
        console.error("Delete failed:", err);
        const errMessage = err?.data?.error || err.message || "";
        if (err?.status === 429) {
          showAlert({
            title: t("instanceActions.submitFailed"),
            message: t("rate_limit_error"),
            type: "warning"
          });
        } else {
          showAlert({
            title: t("instanceActions.delete.failedTitle"),
            message: t("instanceActions.delete.failedMessage"),
            type: "error",
            details: errMessage
          });
        }
      } finally {
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleArchive = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (deletingIds.has(id)) return;
    const confirmed = await showConfirm({
      title: t("instanceActions.archive.title"),
      message: t("action_archive_confirm"),
      type: "warning",
      confirmText: t("instanceActions.archive.confirm"),
      cancelText: t("action_cancel")
    });
    if (confirmed) {
      setDeletingIds(prev => new Set(prev).add(id));
      try {
        await api.delete(`/api/instances/${id}?archive=true`);
        recentActions.register(id, "archive");
        fetchInstances();
        showToast(t("instanceActions.archive.success"), "success");
      } catch (err: any) {
        console.error("Archive failed:", err);
        const errMessage = err?.data?.error || err.message || "";
        if (err?.status === 429) {
          showAlert({
            title: t("instanceActions.submitFailed"),
            message: t("rate_limit_error"),
            type: "warning"
          });
        } else {
          showAlert({
            title: t("instanceActions.archive.failedTitle"),
            message: t("instanceActions.archive.failedMessage"),
            type: "error",
            details: errMessage
          });
        }
      } finally {
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleRestore = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (restoringIds.has(id)) return;
    const confirmed = await showConfirm({
      title: t("instanceActions.restore.title"),
      message: t("action_restore_confirm"),
      type: "info",
      confirmText: t("instanceActions.restore.confirm"),
      cancelText: t("action_cancel")
    });
    if (confirmed) {
      setRestoringIds(prev => new Set(prev).add(id));
      try {
        await api.post(`/api/instances/${id}/action`, { action: "restore" });
        recentActions.register(id, "restore");
        showToast(t("instanceActions.restore.submitted"), "success");
        fetchInstances();
      } catch (err: any) {
        console.error("Restore failed:", err);
        const errMessage = err?.data?.error || err.message || "";
        showAlert({
          title: t("instanceActions.restore.failedTitle"),
          message: t("instanceActions.restore.failedMessage"),
          type: "error",
          details: errMessage
        });
      } finally {
        setRestoringIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  const handleBulkDelete = async (ids: string[], onProgress?: (current: number, total: number) => void) => {
    let successCount = 0;
    let failedCount = 0;
    const deletedIds: string[] = [];

    const executableIds = ids.filter(id => !deletingIds.has(id));
    const skippedCount = ids.length - executableIds.length;
    if (executableIds.length === 0) {
      return { successCount, failedCount, skippedCount };
    }

    for (let i = 0; i < executableIds.length; i++) {
      const id = executableIds[i];
      if (onProgress) {
        onProgress(i + 1, executableIds.length);
      }
      
      setDeletingIds(prev => new Set(prev).add(id));
      
      try {
        await api.delete(`/api/instances/${id}`);
        deletedIds.push(id);
        successCount++;
      } catch (err: any) {
        console.error(`Delete failed for ${id}:`, err);
        failedCount++;
        if (err?.status === 429) {
          showAlert({
            title: t("instanceActions.rateLimited"),
            message: t("rate_limit_error"),
            type: "warning"
          });
          setDeletingIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          break; // Stop on rate limit to prevent spam
        }
      } finally {
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
    
    fetchInstances();
    return { successCount, failedCount, skippedCount };
  };

  const handleExportConfig = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    try {
      const token = getAuthToken();
      const headers = new Headers();
      if (token && token !== "null" && token !== "undefined") {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(`/api/instances/${id}/export-archive`, {
        method: "GET",
        headers
      });

      if (!response.ok) {
        let errData: any = null;
        try {
          errData = await response.json();
        } catch (errJson) {}
        const errorMessage = errData?.message || errData?.error || response.statusText || t("instanceActions.requestFailedStatus", { status: response.status });
        const exportError = new Error(errorMessage) as ApiError;
        exportError.status = response.status;
        exportError.data = errData || {};
        throw exportError;
      }

      // Read Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = `mybay-agent-backup-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Keep the object URL alive long enough for Chromium to hand the
      // generated archive to its download manager. Revoking it synchronously
      // can cancel programmatic downloads in embedded browser contexts.
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      showToast(t("action_export_archive_success"), "success");
    } catch (err: any) {
      console.error("Export archive failed:", err);
      const errCode = err?.data?.error || err?.data?.code || err?.message || "UNKNOWN_EXPORT_ERROR";
      const isPlanBackupExportRequired = errCode === "PLAN_BACKUP_EXPORT_REQUIRED";
      showAlert({
        title: isPlanBackupExportRequired
          ? t("action_export_archive_plan_required_title")
          : t("action_export_archive_failed"),
        message: isPlanBackupExportRequired
          ? t("action_export_archive_plan_required_message")
          : t("action_export_archive_failed_message"),
        type: isPlanBackupExportRequired ? "warning" : "error",
        details: isPlanBackupExportRequired ? undefined : (err?.data?.message || err?.message || "")
      });
    }
  };

  const handleCopyUrl = (e: React.MouseEvent, url: string, instId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedId(instId);
    showToast(t("instanceActions.urlCopied"), "success");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenLink = (e: React.MouseEvent, inst: AgentInstance) => {
    e.stopPropagation();

    if (inst.configSummary?.storageExceeded) {
       const limitsDisk = inst.limitsDisk;
       if (limitsDisk === "unlimited") {
         showAlert({
           title: t("instanceActions.storageExceeded"),
           message: t("storage_quota_exceeded_unlimited_alert"),
           type: "error"
         });
       } else {
         let limitText = "2GB"; // Default fallback
         if (limitsDisk) {
           const num = parseInt(limitsDisk, 10);
           if (!isNaN(num)) {
             if (limitsDisk.toLowerCase().endsWith("mb") || limitsDisk.toLowerCase().endsWith("m")) {
               const gb = num / 1024;
               if (Number.isInteger(gb)) {
                 limitText = `${gb}GB`;
               } else {
                 limitText = `${gb.toFixed(1).replace(/\.0$/, '')}GB`;
               }
             } else {
               limitText = limitsDisk;
             }
           } else {
             limitText = limitsDisk;
           }
         }
         showAlert({
           title: t("instanceActions.storageExceeded"),
           message: t("storage_quota_exceeded_alert", { limit: limitText }),
           type: "error"
         });
       }
       return;
    }
    
    if (!inst.url) return;
    window.open(inst.url, "_blank", "noopener,noreferrer");
  };

  return {
    copiedId,
    deletingIds,
    actioningIds,
    restoringIds,
    handleInstanceAction,
    handleRecheckHealth,
    handleDelete,
    handleArchive,
    handleRestore,
    handleBulkDelete,
    handleExportConfig,
    handleCopyUrl,
    handleOpenLink
  };
}
