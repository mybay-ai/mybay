import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentInstance } from "../types";
import { api } from "../lib/api";
import { canProbeLocalInstanceReadiness, deriveLocalInstanceReadiness, deriveLocalReadinessChecks } from "../../shared/localInstanceReadiness";

export type InstanceChatReadinessProbe = {
  ready?: boolean;
  runtimeReady?: boolean;
  sendable?: boolean;
  reason?: string;
  error?: string;
  message?: string;
  checkedAt?: string;
  probeStatus?: "checked" | "failed";
};

export function useLocalInstanceReadiness(
  instance: AgentInstance,
  suppliedProbe?: InstanceChatReadinessProbe | null,
  onProbe?: (probe: InstanceChatReadinessProbe) => void,
) {
  const [fetchedProbe, setFetchedProbe] = useState<{ scope: string; probe: InstanceChatReadinessProbe } | null>(null);
  const [checking, setChecking] = useState(false);
  const [revision, setRevision] = useState<{ scope: string; value: number } | null>(null);
  const scope = JSON.stringify([instance.id, instance.status, instance.physical_status, instance.model_config_status, instance.gateway_status]);
  const probeable = canProbeLocalInstanceReadiness({ status: instance.status, physicalStatus: instance.physical_status });
  const manual = revision?.scope === scope ? revision.value : 0;
  const autonomous = suppliedProbe === undefined;
  const shouldFetch = probeable && (autonomous || manual > 0);
  const recheck = useCallback(() => {
    if (probeable) setRevision(previous => ({ scope, value: previous?.scope === scope ? previous.value + 1 : 1 }));
  }, [probeable, scope]);

  useEffect(() => {
    if (!shouldFetch) {
      setFetchedProbe(null);
      setChecking(false);
      setRevision(null);
      return;
    }

    let active = true;
    let controller: AbortController | null = null;
    let generation = 0;
    const probe = async () => {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      setChecking(true);
      try {
        const result = await api.get(`/api/instances/${instance.id}/chat-readiness`, { signal: controller.signal });
        if (active && current === generation) {
          const next: InstanceChatReadinessProbe = { ...result, checkedAt: new Date().toISOString(), probeStatus: "checked" };
          setFetchedProbe({ scope, probe: next });
          onProbe?.(next);
        }
      } catch (error: any) {
        if (active && current === generation && error?.name !== "AbortError") {
          const next: InstanceChatReadinessProbe = { ready: false, reason: error?.code || "PROBE_FAILED", message: error?.message, checkedAt: new Date().toISOString(), probeStatus: "failed" };
          setFetchedProbe({ scope, probe: next });
          onProbe?.(next);
        }
      } finally {
        if (active && current === generation) setChecking(false);
      }
    };

    void probe();
    const timer = autonomous ? window.setInterval(probe, 10_000) : undefined;
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [instance.id, shouldFetch, scope, manual, onProbe, autonomous]);

  const fetched = fetchedProbe?.scope === scope ? fetchedProbe.probe : null;
  // Controlled views own their snapshot; do not override a new parent state with
  // the result of an earlier manual check merely because it has a timestamp.
  const probe = autonomous || (manual > 0 && !onProbe) ? fetched : suppliedProbe;
  return useMemo(() => {
    const input = {
      status: instance.status,
      physicalStatus: instance.physical_status,
      deploymentError: instance.deployment_error,
      modelConfigStatus: instance.model_config_status,
      modelRuntimeStatus: instance.model_runtime_status,
      gatewayStatus: instance.gateway_status,
      configuredChannels: instance.configured_channels,
      connectedChannels: instance.connected_channels,
      chat: probe,
    };
    return { ...deriveLocalInstanceReadiness(input), checks: deriveLocalReadinessChecks(input), checkedAt: probe?.checkedAt || null, checking, recheck, canRecheck: probeable };
  }, [
    instance.status,
    instance.physical_status,
    instance.deployment_error,
    instance.model_config_status,
    instance.model_runtime_status,
    instance.gateway_status,
    instance.configured_channels,
    instance.connected_channels,
    probe,
    checking, recheck, probeable,
  ]);
}
