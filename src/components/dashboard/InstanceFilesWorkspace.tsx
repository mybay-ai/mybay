import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { AgentInstance, User as UserType } from "../../types";
import { buildInstanceFilesNavigationUrl } from "../../constants/routes";
import { InstanceFilesSection } from "../InstanceFilesSection";
import { getRefinedStatusLabel } from "./instanceStatus";

interface InstanceFilesWorkspaceProps {
  instances: AgentInstance[];
  currentUser: UserType;
}

export function InstanceFilesWorkspace({ instances, currentUser }: InstanceFilesWorkspaceProps) {
  const { t } = useTranslation("dashboard");
  const location = useLocation();
  const navigate = useNavigate();
  const queryInstanceId = new URLSearchParams(location.search).get("instanceId");
  const [selectedInstanceId, setSelectedInstanceId] = useState(queryInstanceId || "");

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) || null,
    [instances, selectedInstanceId]
  );
  const statusLabel = selectedInstance ? getRefinedStatusLabel(selectedInstance) : null;

  useEffect(() => {
    if (!queryInstanceId) {
      setSelectedInstanceId("");
      return;
    }
    const queryInstance = instances.find((instance) => instance.id === queryInstanceId);
    setSelectedInstanceId(queryInstance?.id || "");
  }, [instances, queryInstanceId]);

  const handleInstanceChange = (instanceId: string) => {
    setSelectedInstanceId(instanceId);
    navigate(buildInstanceFilesNavigationUrl(instanceId), {
      replace: true,
      state: { activeTab: "instance-files" }
    });
  };

  if (instances.length === 0) {
    return (
      <div className="rounded-2xl border border-outline bg-surface p-10 text-center shadow-sm">
        <FolderOpen className="mx-auto h-10 w-10 text-content-muted" />
        <h2 className="mt-3 text-sm font-semibold text-content">{t("files_center_empty_title")}</h2>
        <p className="mt-1 text-xs text-content-muted">{t("files_center_empty_desc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-outline bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-500">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("files_center_title")}</p>
              <p className="mt-1 truncate text-sm font-bold text-content">
                {selectedInstance?.name || t("files_center_select_instance")}
              </p>
            </div>
          </div>

          <label className="relative block w-full lg:w-[280px]">
            <span className="sr-only">{t("files_center_select_instance")}</span>
            <select
              value={selectedInstanceId}
              onChange={(event) => handleInstanceChange(event.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-outline bg-control pl-3 pr-9 text-sm font-medium text-content outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="" disabled>{t("files_center_select_instance")}</option>
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>{instance.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-content-muted" />
          </label>
        </div>

        {selectedInstance && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-outline/60 pt-3 text-xs text-content-muted">
            <span className="font-mono break-all">ID: {selectedInstance.id}</span>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${statusLabel?.textClass || ""}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusLabel?.color || "bg-slate-400"}`} />
              {statusLabel?.i18nKey ? t(statusLabel.i18nKey) : statusLabel?.text}
            </span>
            <span>{t("files_center_root_hint")}</span>
          </div>
        )}
      </div>

      {selectedInstance ? (
        <div className="min-h-[620px] overflow-hidden rounded-2xl border border-outline bg-surface shadow-sm">
          <InstanceFilesSection instanceId={selectedInstance.id} currentUser={currentUser} />
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-700 dark:text-amber-300">
          {queryInstanceId ? t("files_center_invalid_instance") : t("files_center_select_instance")}
        </div>
      )}
    </div>
  );
}
