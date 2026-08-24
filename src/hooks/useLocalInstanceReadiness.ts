import { useEffect, useMemo, useState } from "react";
import type { AgentInstance } from "../types";
import { api } from "../lib/api";
import { deriveLocalInstanceReadiness } from "../../shared/localInstanceReadiness";

export type InstanceChatReadinessProbe = {
  ready?: boolean;
  runtimeReady?: boolean;
  sendable?: boolean;
  reason?: string;
  error?: string;
  message?: string;
};

function canProbe(instance: AgentInstance): boolean {
  const status = String(instance.status || "").toLowerCase();
  const physical = String(instance.physical_status || "").toLowerCase();
  return physical === "running" || ["running", "gateway_ready", "partial_running", "dashboard_ready", "unhealthy", "failed"].includes(status);
}

export function useLocalInstanceReadiness(
  instance: AgentInstance,
  suppliedProbe?: InstanceChatReadinessProbe | null,
) {
  const [fetchedProbe, setFetchedProbe] = useState<{ instanceId: string; probe: InstanceChatReadinessProbe } | null>(null);
  const shouldFetch = suppliedProbe === undefined && canProbe(instance);

  useEffect(() => {
    if (!shouldFetch) {
      setFetchedProbe(null);
      return;
    }

    let active = true;
    let controller: AbortController | null = null;
    const probe = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await api.get(`/api/instances/${instance.id}/chat-readiness`, { signal: controller.signal });
        if (active) setFetchedProbe({ instanceId: instance.id, probe: result });
      } catch (error: any) {
        if (active && error?.name !== "AbortError") {
          setFetchedProbe({ instanceId: instance.id, probe: { ready: false, reason: error?.code || "PROBE_FAILED", message: error?.message } });
        }
      }
    };

    void probe();
    const timer = window.setInterval(probe, 10_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [instance.id, shouldFetch]);

  const probe = suppliedProbe === undefined
    ? fetchedProbe?.instanceId === instance.id ? fetchedProbe.probe : null
    : suppliedProbe;
  return useMemo(() => deriveLocalInstanceReadiness({
    status: instance.status,
    physicalStatus: instance.physical_status,
    deploymentError: instance.deployment_error,
    modelConfigStatus: instance.model_config_status,
    gatewayStatus: instance.gateway_status,
    configuredChannels: instance.configured_channels,
    connectedChannels: instance.connected_channels,
    chat: probe,
  }), [
    instance.status,
    instance.physical_status,
    instance.deployment_error,
    instance.model_config_status,
    instance.gateway_status,
    instance.configured_channels,
    instance.connected_channels,
    probe,
  ]);
}
