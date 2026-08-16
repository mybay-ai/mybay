import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../lib/api";

export const QUOTA_CONSUMING_STATUSES = new Set([
  "creating",
  "container_starting",
  "dashboard_ready",
  "gateway_starting",
  "gateway_ready",
  "running",
  "partial_running",
  "unhealthy",
  "stopped",
  "deploying",
  "initializing",
  "restarting",
  "failed",
  "starting",
  "pending",
  "provisioning",
  "error",
  "frontend_missing_build"
]);

export interface InstanceQuotaResult {
  activeInstances: number;
  maxActiveInstances: number;
  canCreateInstance: boolean;
  plan: string;
  subscriptionPlan?: string;
  features?: Record<string, any>;
  externalChannelsAllowed: boolean;
  totalDiskQuotaMb: number | null;
  allocatedDiskMb: number;
  remainingDiskMb: number | null;
  defaultInstanceDiskMb: number;
  maxSingleInstanceDiskMb: number | null;
  isDiskOverAllocated: boolean;
  entitlementsReady: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useInstanceQuota(currentUser: any, instances: any[] = []): InstanceQuotaResult {
  const [quotaState, setQuotaState] = useState<{
    activeInstances: number;
    maxActiveInstances: number;
    canCreateInstance: boolean;
    allocatedDiskMb: number;
    defaultInstanceDiskMb: number;
    loading: boolean;
  }>({
    activeInstances: 0,
    maxActiveInstances: 10,
    canCreateInstance: true,
    allocatedDiskMb: 4096,
    defaultInstanceDiskMb: 4096,
    loading: false
  });

  const activeCountLocalCount = useMemo(() => {
    return instances.filter((inst: any) => {
      if (inst.archived) return false;
      const status = inst.status || "";
      return QUOTA_CONSUMING_STATUSES.has(status.toLowerCase());
    }).length;
  }, [instances]);

  const fetchQuota = useCallback(async () => {
    if (!currentUser) return;
    setQuotaState(prev => ({ ...prev, loading: true }));
    try {
      const data = await api.get("/api/instances/me/quota");
      if (data) {
        setQuotaState({
          activeInstances: Number(data.instanceUsed ?? activeCountLocalCount),
          maxActiveInstances: data.instanceLimit === null ? 999 : Number(data.instanceLimit ?? 10),
          canCreateInstance: Boolean(data.canCreateInstance ?? true),
          allocatedDiskMb: Number(data.allocatedDiskMb ?? 4096),
          defaultInstanceDiskMb: Number(data.defaultInstanceDiskMb ?? 4096),
          loading: false
        });
        return;
      }
    } catch (err) {
      // Fallback
    }
    setQuotaState({
      activeInstances: activeCountLocalCount,
      maxActiveInstances: 10,
      canCreateInstance: activeCountLocalCount < 10,
      allocatedDiskMb: 4096,
      defaultInstanceDiskMb: 4096,
      loading: false
    });
  }, [currentUser, activeCountLocalCount]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  return {
    activeInstances: quotaState.activeInstances || activeCountLocalCount,
    maxActiveInstances: quotaState.maxActiveInstances,
    canCreateInstance: quotaState.canCreateInstance,
    plan: "MyBay Open Source",
    subscriptionPlan: "MyBay Open Source",
    features: { external_channels: true, backup_export: true },
    externalChannelsAllowed: true,
    totalDiskQuotaMb: quotaState.defaultInstanceDiskMb,
    allocatedDiskMb: quotaState.allocatedDiskMb,
    remainingDiskMb: null,
    defaultInstanceDiskMb: quotaState.defaultInstanceDiskMb,
    maxSingleInstanceDiskMb: quotaState.defaultInstanceDiskMb,
    isDiskOverAllocated: false,
    entitlementsReady: true,
    loading: quotaState.loading,
    refresh: fetchQuota
  };
}
