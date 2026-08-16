import React, { useState, useEffect, useMemo, useRef } from "react";
import { RefreshCw, CheckCircle, AlertCircle, Loader2, ArrowUpRight, History, Play, AlertTriangle, Terminal, Layers, Box, Check, ChevronDown, Clock, Zap, Filter, MoreHorizontal } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button, Card, cn } from "./ui";
import { useFeedback } from "./FeedbackProvider";
import { VersionDetailsDrawer } from "./version-management/VersionDetailsDrawer";
import { VersionOverviewCards } from "./version-management/VersionOverviewCards";
import { VersionOfficialCard } from "./version-management/VersionOfficialCard";
import { VersionFilters } from "./version-management/VersionFilters";
import { VersionLogsModal } from "./version-management/VersionLogsModal";
import { VersionRepositoryPreview } from "./version-management/VersionRepositoryPreview";
import { VersionMobileInstanceCards } from "./version-management/VersionMobileInstanceCards";
import { VersionDesktopInstanceTable } from "./version-management/VersionDesktopInstanceTable";
import { compareHermesVersions } from "../../shared/version";

interface VersionItem {
  tag: string;
  version: string;
  desc: string;
  releaseAt: string;
  image: string;
  is_prewarmed?: boolean | number;
  prewarm_status?: string;
  is_latest?: boolean | number;
  feishu_capable?: boolean;
  capabilities?: string[];
  coreVariant?: any;
  feishuVariant?: any;
}

interface VersionManagementProps {
  instances: any[];
  currentUser: any;
  fetchInstances: () => void;
  socket: any;
}

export function VersionManagement({ instances, currentUser, fetchInstances, socket }: VersionManagementProps) {
  const { t } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [selectedInstances, setSelectedInstances] = useState<string[]>([]);
  const [targetTag, setTargetTag] = useState<string>("latest");
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [bulkUpgrading, setBulkUpgrading] = useState(false);
  const [syncingOfficial, setSyncingOfficial] = useState(false);
  const [prewarmingVersion, setPrewarmingVersion] = useState<string | null>(null);
  const [logsInstanceId, setLogsInstanceId] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [detailsInstanceId, setDetailsInstanceId] = useState<string | null>(null);
  const [refreshingInstances, setRefreshingInstances] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [versionFilter, setVersionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [systemTagFilter, setSystemTagFilter] = useState("all");
  const debounceTimeoutRef = useRef<any>(null);

  const handleRefreshInstances = async () => {
    setRefreshingInstances(true);
    try {
      await fetchInstances();
    } finally {
      setTimeout(() => setRefreshingInstances(false), 800);
    }
  };

  const isLowerVersion = (v1?: string, v2?: string): boolean =>
    !!v1 && !!v2 && compareHermesVersions(v1, v2) < 0;

  // The API is already sorted and marks the synchronized upstream latest.
  const latestOfficial = versions.find((version: any) => version.is_latest) || versions[0];
  const latestOfficialVer = latestOfficial?.version || "";

  // Check if a given inst needs update using semver rules
  const doesInstanceNeedUpdate = (inst: any) => {
    const cur = inst.resolved_version || inst.agent_version || inst.agent_image_tag || "latest";
    if (cur === "latest") return false;
    return isLowerVersion(cur, latestOfficialVer);
  };

  const getActiveVersion = (inst: any) => inst.resolved_version || inst.agent_version || inst.agent_image_tag || "latest";

  const getInstanceSystemTags = (inst: any): string[] => {
    const tags = new Set<string>();
    const addTag = (value: any) => {
      if (typeof value !== "string") return;
      const normalized = value.trim().toLowerCase();
      if (normalized) tags.add(normalized);
    };

    if (Array.isArray(inst.configuredChannels)) {
      inst.configuredChannels.forEach(addTag);
    }
    addTag(inst.channel);
    addTag(inst.channel_type);
    addTag(inst.instance_type);
    addTag(inst.runtime_type);
    addTag(inst.template_key);
    addTag(inst.template_id);
    addTag(inst.template_name);
    addTag(inst.billing_mode);
    addTag(inst.model_source);

    const config = typeof inst.config_json === "string" ? (() => {
      try {
        return JSON.parse(inst.config_json);
      } catch {
        return null;
      }
    })() : inst.config_json;

    addTag(config?.channel);
    addTag(config?.channel_type);
    addTag(config?.template_key);
    addTag(config?.templateId);
    addTag(config?.template_id);
    addTag(config?.billing_mode);
    addTag(config?.model_source);

    if (tags.size === 0 || tags.has("web")) {
      tags.add("web");
    }
    if ((inst.agent_image_tag || "").toLowerCase().includes("feishu") || (inst.agent_version || "").toLowerCase().includes("feishu")) {
      tags.add("feishu");
    }

    return Array.from(tags).sort();
  };

  const matchesStatusFilter = (inst: any, filter: string) => {
    if (filter === "all") return true;
    if (filter === "latest") return inst.upgrade_status !== "failed" && !doesInstanceNeedUpdate(inst);
    if (filter === "outdated") return inst.upgrade_status !== "failed" && doesInstanceNeedUpdate(inst);
    if (filter === "success") return inst.upgrade_status === "success";
    if (filter === "failed") return inst.upgrade_status === "failed";
    if (filter === "rollback") return Boolean(inst.previous_image_tag);
    return true;
  };

  const visibleVersions = useMemo(() => {
    const values = new Set<string>();
    instances.forEach(inst => values.add(getActiveVersion(inst)));
    return Array.from(values).filter(Boolean).sort();
  }, [instances]);

  const visibleSystemTags = useMemo(() => {
    const values = new Set<string>();
    instances.forEach(inst => getInstanceSystemTags(inst).forEach(tag => values.add(tag)));
    return Array.from(values).sort();
  }, [instances]);

  const filteredInstances = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return instances.filter((inst) => {
      const activeVersion = getActiveVersion(inst);
      const systemTags = getInstanceSystemTags(inst);
      const matchesStatus = matchesStatusFilter(inst, statusFilter);
      const searchable = [
        inst.name,
        inst.id,
        inst.owner,
        inst.user_email,
        inst.user_id,
        activeVersion,
        inst.agent_image_tag,
        inst.agent_version,
        inst.resolved_version,
        ...systemTags
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (query && !searchable.includes(query)) return false;
      if (versionFilter !== "all" && activeVersion !== versionFilter) return false;
      if (!matchesStatus) return false;
      if (systemTagFilter !== "all" && !systemTags.includes(systemTagFilter)) return false;
      return true;
    });
  }, [instances, latestOfficialVer, searchQuery, versionFilter, statusFilter, systemTagFilter]);

  const totalInstances = instances.length;
  const latestInstances = instances.filter(inst => inst.upgrade_status !== "failed" && !doesInstanceNeedUpdate(inst)).length;
  const needUpdateInstances = instances.filter(inst => inst.upgrade_status !== "failed" && doesInstanceNeedUpdate(inst)).length;
  const abnormalInstances = instances.filter(inst => inst.upgrade_status === "failed" || inst.status === "unhealthy" || inst.status === "error").length;
  const latestBatchUpgradeAt = instances
    .map(inst => inst.last_upgrade_at ? new Date(inst.last_upgrade_at).getTime() : 0)
    .filter(time => Number.isFinite(time) && time > 0)
    .sort((a, b) => b - a)[0];
  const filteredInstanceIds = useMemo(() => filteredInstances.map(inst => inst.id), [filteredInstances]);
  const selectedVisibleInstances = useMemo(() => (
    filteredInstances.filter(inst => selectedInstances.includes(inst.id))
  ), [filteredInstances, selectedInstances]);
  const selectedVisibleInstanceIds = useMemo(() => selectedVisibleInstances.map(inst => inst.id), [selectedVisibleInstances]);
  const detailsInstance = useMemo(() => (
    detailsInstanceId ? instances.find(inst => inst.id === detailsInstanceId) || null : null
  ), [detailsInstanceId, instances]);

  useEffect(() => {
    fetchVersions();
  }, []);

  useEffect(() => {
    if (socket) {
      const handleLogsUpdate = (data: any) => {
        if (logsInstanceId) {
          fetchLogs(logsInstanceId);
        }
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
        debounceTimeoutRef.current = setTimeout(() => {
          fetchInstances();
        }, 500);
      };

      const handlePrewarmStatus = (data: { version: string; tag?: string; status: string }) => {
        setVersions(prev => prev.map(v => {
          let updated = false;
          let core = v.coreVariant;
          let feishu = v.feishuVariant;
          
          const keyToMatch = data.tag || data.version;
          
          if (core && (core.tag === keyToMatch || core.version === keyToMatch)) {
            core = { ...core, prewarm_status: data.status, is_prewarmed: data.status === 'cached' ? 1 : core.is_prewarmed };
            updated = true;
          }
          if (feishu && (feishu.tag === keyToMatch || feishu.version === keyToMatch)) {
            feishu = { ...feishu, prewarm_status: data.status, is_prewarmed: data.status === 'cached' ? 1 : feishu.is_prewarmed };
            updated = true;
          }
          
          if (updated) {
            const primary = core || feishu;
            return {
              ...v,
              coreVariant: core,
              feishuVariant: feishu,
              prewarm_status: primary?.prewarm_status,
              is_prewarmed: primary?.is_prewarmed ? 1 : 0
            };
          } else if (v.version === keyToMatch || v.tag === keyToMatch) {
            return {
              ...v,
              prewarm_status: data.status,
              is_prewarmed: data.status === 'cached' ? 1 : v.is_prewarmed
            };
          }
          return v;
        }));
        if (data.status === 'cached' || data.status === 'failed') {
          setPrewarmingVersion(null);
        }
      };
      socket.on("instances_updated", handleLogsUpdate);
      socket.on("system:prewarm_status", handlePrewarmStatus);
      return () => {
        socket.off("instances_updated", handleLogsUpdate);
        socket.off("system:prewarm_status", handlePrewarmStatus);
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }
  }, [socket, logsInstanceId, fetchInstances]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  const fetchVersions = async () => {
    setLoadingVersions(true);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/mybay-versions", {
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setVersions(data.map((v: any) => ({
           tag: v.image_tag || v.tag || v.familyVersion || v.version,
           version: v.familyVersion || v.version,
           desc: v.changelog || "",
           releaseAt: v.published_at ? v.published_at.substring(0, 10) : "",
           image: v.image || "nousresearch/hermes-agent",
           is_prewarmed: v.is_prewarmed,
           prewarm_status: v.prewarm_status,
           is_latest: v.is_latest,
           capabilities: v.capabilities,
           feishu_capable: v.feishu_capable,
           coreVariant: v.coreVariant,
           feishuVariant: v.feishuVariant
        })));
        if (data.length > 0) {
          setTargetTag(data[0].familyVersion || data[0].image_tag || data[0].tag || data[0].version);
        }
      }
    } catch (e) {
      console.error("Failed to fetch agent versions:", e);
    } finally {
      setLoadingVersions(false);
    }
  };

  const handlePrewarm = async (v: VersionItem) => {
    setPrewarmingVersion(v.version);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/mybay-versions/prewarm", {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          version: v.version,
          image: v.image,
          tag: v.tag
        })
      });
      if (!res.ok) {
        const data = await res.json();
        showAlert({
          title: t("versionRepository.prewarm.failedTitle"),
          message: t("versionRepository.prewarm.failedMessage"),
          type: "error",
          details: data.error || t("versionRepository.prewarm.unknownDetail")
        });
        setPrewarmingVersion(null);
      }
    } catch (err: any) {
      showAlert({
        title: t("versionRepository.prewarm.failedTitle"),
        message: t("versionRepository.prewarm.networkMessage"),
        type: "error",
        details: err.message
      });
      setPrewarmingVersion(null);
    }
  };

  const handleSyncOfficial = async () => {
    setSyncingOfficial(true);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/mybay-versions/sync", {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (res.ok) {
        const feedback = [
          data.hasNewVersions
            ? t("versionRepository.sync.newVersions", {
                count: data.newlyDiscoveredCount,
                versions: data.newVersions.join(", ")
              })
            : t("versionRepository.sync.noNewVersions"),
          data.latestVersion
            ? t("versionRepository.sync.latestVersion", { version: data.latestVersion })
            : ""
        ].filter(Boolean).join("\n\n");
        showAlert({
          title: t("versionRepository.sync.successTitle"),
          message: feedback,
          type: "success"
        });
        await fetchVersions();
        fetchInstances();
      } else {
        showAlert({
          title: t("versionRepository.sync.failedTitle"),
          message: t("versionRepository.sync.failedMessage"),
          type: "error",
          details: data.error || t("versionRepository.sync.invalidResponse")
        });
      }
    } catch (err: any) {
      showAlert({
        title: t("versionRepository.sync.failedTitle"),
        message: t("versionRepository.sync.networkMessage"),
        type: "error",
        details: err.message
      });
    } finally {
      setSyncingOfficial(false);
    }
  };

  const fetchLogs = async (id: string) => {
    setLoadingLogs(true);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {};
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${id}/upgrade-logs`, {
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleOpenLogs = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLogsInstanceId(id);
    fetchLogs(id);
    setShowLogsModal(true);
  };

  const handleUpgradeSingle = async (id: string, tag: string, e: React.MouseEvent) => {
    if (e && e.stopPropagation) e.stopPropagation();

    // Check Feishu upgrade compatibility
    const inst = instances.find(i => i.id === id);
    const tarVer = versions.find(v => v.tag === tag);
    const isFeishuInst = inst && (inst.configuredChannels?.includes("feishu") || inst.configuredChannels?.includes("lark") || inst.channel === "feishu" || inst.channel === "lark");

    const isFeishuCapable = tarVer ? (
      tarVer.capabilities?.includes("feishu") || tarVer.feishu_capable === true
    ) : false;

    if (isFeishuInst && tag !== "latest" && tarVer && !isFeishuCapable) {
      showAlert({
        title: t("versionRepository.management.upgradeFailed"),
        message: t("versionRepository.management.single.feishuUnsupported", { name: inst.name, tag }),
        type: "warning"
      });
      return;
    }

    if (tag === "latest" && isFeishuInst) {
      const confirmed = await showConfirm({
        title: t("versionRepository.management.confirmUpgrade"),
        message: t("versionRepository.management.single.latestFeishuConfirm", { name: inst.name }),
        type: "info",
        confirmText: t("versionRepository.management.executeUpgrade"),
        cancelText: t("versionRepository.management.cancel")
      });
      if (!confirmed) {
        return;
      }
    }

    setUpgradingId(id);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${id}/upgrade`, {
        method: "POST",
        headers,
        body: JSON.stringify({ tag })
      });
      const data = await res.json();
      if (res.ok) {
        const resolvedText = data.resolvedTag ? t("versionRepository.management.single.resolvedTag", { tag: data.resolvedTag }) : "";
        showToast(t("versionRepository.management.single.submitted", { resolvedText }), "success");
        fetchInstances();
      } else {
        showAlert({
          title: t("versionRepository.management.upgradeFailed"),
          message: t("versionRepository.management.single.submitFailed"),
          type: "error",
          details: data.error || t("versionRepository.management.unknownUnderlyingError")
        });
      }
    } catch (err: any) {
      showAlert({
        title: t("versionRepository.management.upgradeFailed"),
        message: t("versionRepository.management.apiUnavailable"),
        type: "error",
        details: err.message
      });
    } finally {
      setUpgradingId(null);
    }
  };

  const handleRollbackSingle = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const inst = instances.find(i => i.id === id);
    const previousTag = inst?.previous_image_tag || "latest";
    const confirmed = await showConfirm({
      title: t("versionRepository.management.rollback.confirmTitle"),
      message: t("versionRepository.management.rollback.confirmMessage", { name: inst?.name || id, tag: previousTag }),
      type: "warning",
      confirmText: t("versionRepository.management.rollback.confirmAction"),
      cancelText: t("versionRepository.management.cancel")
    });
    if (!confirmed) return;
    setRollingBackId(id);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/instances/${id}/rollback`, {
        method: "POST",
        headers
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("versionRepository.management.rollback.submitted"), "success");
        fetchInstances();
      } else {
        showAlert({
          title: t("versionRepository.management.rollback.failedTitle"),
          message: t("versionRepository.management.rollback.failedMessage"),
          type: "error",
          details: data.error || t("versionRepository.management.rollback.invalidResponse")
        });
      }
    } catch (err: any) {
      showAlert({
        title: t("versionRepository.management.rollback.failedTitle"),
        message: t("versionRepository.management.apiUnavailable"),
        type: "error",
        details: err.message
      });
    } finally {
      setRollingBackId(null);
    }
  };

  const handleBulkUpgrade = async (overrideTag?: string) => {
    if (selectedVisibleInstanceIds.length === 0) {
      showAlert({
        title: t("versionRepository.management.bulk.submitFailedTitle"),
        message: t("versionRepository.management.bulk.selectAtLeastOne"),
        type: "warning"
      });
      return;
    }

    // Check Feishu upgrade compatibility for all selected instances
    const selectedFeishuInsts = selectedVisibleInstances.filter(inst =>
      (inst.configuredChannels?.includes("feishu") || inst.configuredChannels?.includes("lark") || inst.channel === "feishu" || inst.channel === "lark")
    );
    const effectiveTargetTag = overrideTag || targetTag;
    const tarVer = versions.find(v => v.tag === effectiveTargetTag);

    const isFeishuCapable = tarVer ? (
      tarVer.capabilities?.includes("feishu") || tarVer.feishu_capable === true
    ) : false;

    if (selectedFeishuInsts.length > 0 && tarVer && !isFeishuCapable) {
      showAlert({
        title: t("versionRepository.management.upgradeFailed"),
        message: t("versionRepository.management.bulk.feishuUnsupported", {
          names: selectedFeishuInsts.map(i => i.name).join(", "),
          tag: effectiveTargetTag
        }),
        type: "warning"
      });
      return;
    }

    const confirmed = await showConfirm({
      title: t("versionRepository.management.confirmUpgrade"),
      message: t("versionRepository.management.bulk.confirmMessage", { count: selectedVisibleInstanceIds.length, tag: effectiveTargetTag }),
      type: "warning",
      confirmText: t("versionRepository.management.bulk.confirmAction"),
      cancelText: t("versionRepository.management.cancel")
    });
    if (!confirmed) {
      return;
    }
    setBulkUpgrading(true);
    try {
      const token = currentUser?.token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (token && token !== "null" && token !== "undefined") {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/instances/bulk-upgrade", {
        method: "POST",
        headers,
        body: JSON.stringify({
          instanceIds: selectedVisibleInstanceIds,
          tag: effectiveTargetTag
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(t("versionRepository.management.bulk.submitted"), "success");
        setSelectedInstances([]);
        fetchInstances();
      } else {
        showAlert({
          title: t("versionRepository.management.upgradeFailed"),
          message: t("versionRepository.management.bulk.failedMessage"),
          type: "error",
          details: data.error || t("versionRepository.management.unknownError")
        });
      }
    } catch (err: any) {
      showAlert({
        title: t("versionRepository.management.upgradeFailed"),
        message: t("versionRepository.management.bulk.serviceUnavailable"),
        type: "error",
        details: err.message
      });
    } finally {
      setBulkUpgrading(false);
    }
  };

  const handleFilterOutdatedOnly = () => {
    setStatusFilter("outdated");
  };

  const handleSelectOutdatedVisible = () => {
    const outdatedIds = filteredInstances
      .filter(inst => inst.upgrade_status !== "failed" && doesInstanceNeedUpdate(inst))
      .map(inst => inst.id);
    setSelectedInstances(prev => Array.from(new Set([...prev, ...outdatedIds])));
  };

  const toggleSelectInstance = (id: string) => {
    setSelectedInstances(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredInstanceIds;
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedInstances.includes(id));
    if (allVisibleSelected) {
      setSelectedInstances(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedInstances(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  return (
    <div className="space-y-6">
      <VersionOverviewCards
        totalInstances={totalInstances}
        latestInstances={latestInstances}
        needUpdateInstances={needUpdateInstances}
        abnormalInstances={abnormalInstances}
        latestBatchUpgradeAt={latestBatchUpgradeAt}
        refreshingInstances={refreshingInstances}
        onRefreshInstances={handleRefreshInstances}
      />
      <VersionOfficialCard
        currentUser={currentUser}
        latestOfficial={latestOfficial}
        latestOfficialVer={latestOfficialVer}
        syncingOfficial={syncingOfficial}
        prewarmingVersion={prewarmingVersion}
        onSyncOfficial={handleSyncOfficial}
        onPrewarm={handlePrewarm}
      />
      <VersionFilters
        searchQuery={searchQuery}
        versionFilter={versionFilter}
        statusFilter={statusFilter}
        systemTagFilter={systemTagFilter}
        visibleVersions={visibleVersions}
        visibleSystemTags={visibleSystemTags}
        filteredCount={filteredInstances.length}
        totalCount={totalInstances}
        onSearchQueryChange={setSearchQuery}
        onVersionFilterChange={setVersionFilter}
        onStatusFilterChange={setStatusFilter}
        onSystemTagFilterChange={setSystemTagFilter}
      />
      {/* Bulk Operations Toolbar */}
      <Card className="p-4 bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-md flex flex-col gap-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4" />
            </div>
            <div className="text-left">
              <h4 className="text-[13px] font-bold text-slate-300">{t("versionRepository.management.bulk.panelTitle")}</h4>
              <p className="text-[13px] text-content-muted mt-0.5">{t("versionRepository.management.bulk.panelDescription")}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-stretch sm:items-center">
            <div className="relative shrink-0">
              <select
                value={targetTag}
                onChange={(e) => setTargetTag(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white px-3 py-2 pr-8 rounded-xl text-[13px] font-bold w-full sm:w-48 outline-none appearance-none cursor-pointer focus:border-blue-500 transition-colors"
              >
                <option value="latest">latest ({t("versionRepository.followLatest")})</option>
                {loadingVersions ? (
                  <option>{t("versionRepository.loadingImages")}</option>
                ) : (
                  versions.map((ver) => {
                    const hasSelectedFeishu = selectedVisibleInstances.some(inst =>
                      (inst.configuredChannels?.includes("feishu") || inst.configuredChannels?.includes("lark") || inst.channel === "feishu" || inst.channel === "lark")
                    );
                    const isFeishuCapable = ver.capabilities?.includes("feishu") || ver.feishu_capable === true;
                    const isFeishuIncompatible = hasSelectedFeishu && !isFeishuCapable;
                    return (
                      <option key={ver.tag} value={ver.tag} disabled={isFeishuIncompatible}>
                        {ver.tag} {ver.is_prewarmed ? "⚡" : ""} {ver.tag === latestOfficialVer ? "(" + t("versionRepository.recommended") + ")" : ""} {isFeishuIncompatible ? " (" + t("versionRepository.feishuUnsupported") + ")" : ""}
                      </option>
                    );
                  })
                )}
              </select>
              <ChevronDown className="w-4 h-4 text-content-muted absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <Button
              onClick={() => handleBulkUpgrade()}
              disabled={selectedVisibleInstanceIds.length === 0 || bulkUpgrading}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold h-10 px-4 rounded-xl text-[13px] flex items-center justify-center gap-2 whitespace-nowrap active:scale-95 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              {bulkUpgrading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              <span>{t("versionRepository.management.bulk.submit", { count: selectedVisibleInstanceIds.length })}</span>
            </Button>

            <Button
              onClick={() => handleBulkUpgrade("latest")}
              disabled={selectedVisibleInstanceIds.length === 0 || bulkUpgrading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold h-10 px-3 rounded-xl text-[13px] flex items-center justify-center gap-2 whitespace-nowrap active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{t("versionRepository.management.bulk.upgradeLatest")}</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
          <Button
            onClick={handleFilterOutdatedOnly}
            className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[13px] font-semibold flex items-center gap-1.5"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{t("versionRepository.management.bulk.outdatedOnly")}</span>
          </Button>
          <Button
            onClick={handleSelectOutdatedVisible}
            className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[13px] font-semibold flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t("versionRepository.management.bulk.selectOutdated")}</span>
          </Button>
          <Button
            onClick={handleRefreshInstances}
            disabled={refreshingInstances}
            className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshingInstances && "animate-spin")} />
            <span>{t("versionRepository.management.bulk.checkStatus")}</span>
          </Button>
          <Button
            onClick={() => setStatusFilter("success")}
            className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[13px] font-semibold flex items-center gap-1.5"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{t("versionRepository.management.bulk.viewResults")}</span>
          </Button>
        </div>

        {targetTag === "latest" && (
          <div className="text-left bg-slate-900 border border-slate-800/80 p-3 rounded-xl flex items-start gap-2.5 text-[13px] text-slate-300">
            <span className="text-amber-400 text-base shrink-0 select-none">💡</span>
            <div>
              <span className="text-blue-400 font-bold block mb-0.5">{t("versionRepository.management.latestProtection.title")}</span>
              <p className="text-content-muted leading-relaxed">
                <Trans
                  t={t}
                  i18nKey="versionRepository.management.latestProtection.description"
                  components={{
                    latest: <code />,
                    feishu: <strong />,
                    routed: <strong />
                  }}
                />
              </p>
            </div>
          </div>
        )}
      </Card>

      <VersionMobileInstanceCards
        filteredInstances={filteredInstances}
        selectedInstances={selectedInstances}
        versions={versions}
        rollingBackId={rollingBackId}
        doesInstanceNeedUpdate={doesInstanceNeedUpdate}
        toggleSelectInstance={toggleSelectInstance}
        setDetailsInstanceId={setDetailsInstanceId}
        handleOpenLogs={handleOpenLogs}
        handleRollbackSingle={handleRollbackSingle}
        handleUpgradeSingle={handleUpgradeSingle}
      />

      <VersionRepositoryPreview
        versions={versions}
        currentUser={currentUser}
        latestOfficialVer={latestOfficialVer}
        loadingVersions={loadingVersions}
        prewarmingVersion={prewarmingVersion}
        fetchVersions={fetchVersions}
        handlePrewarm={handlePrewarm}
      />

      <VersionDesktopInstanceTable
        filteredInstances={filteredInstances}
        selectedInstances={selectedInstances}
        versions={versions}
        latestOfficialVer={latestOfficialVer}
        doesInstanceNeedUpdate={doesInstanceNeedUpdate}
        toggleSelectInstance={toggleSelectInstance}
        toggleSelectAll={toggleSelectAll}
        setDetailsInstanceId={setDetailsInstanceId}
        handleOpenLogs={handleOpenLogs}
        handleRollbackSingle={handleRollbackSingle}
        handleUpgradeSingle={handleUpgradeSingle}
      />

      <VersionDetailsDrawer
        instance={detailsInstance}
        isRollingBack={detailsInstance ? rollingBackId === detailsInstance.id : false}
        isUpgrading={detailsInstance ? upgradingId === detailsInstance.id : false}
        getActiveVersion={getActiveVersion}
        doesInstanceNeedUpdate={doesInstanceNeedUpdate}
        getInstanceSystemTags={getInstanceSystemTags}
        onClose={() => setDetailsInstanceId(null)}
        onOpenLogs={handleOpenLogs}
        onRollback={handleRollbackSingle}
        onUpgradeLatest={(id, e) => handleUpgradeSingle(id, "latest", e)}
      />
      <VersionLogsModal
        showLogsModal={showLogsModal}
        logsInstanceId={logsInstanceId}
        logs={logs}
        loadingLogs={loadingLogs}
        onClose={() => { setShowLogsModal(false); setLogsInstanceId(null); }}
        onRefreshLogs={() => logsInstanceId && fetchLogs(logsInstanceId)}
      />

    </div>
  );
}
