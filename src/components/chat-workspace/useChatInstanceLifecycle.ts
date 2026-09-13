import { useEffect, type Dispatch, type SetStateAction, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { AgentInstance } from "../../types";
import { api } from "../../lib/api";
import { shouldAcceptConversationHistory } from "../../lib/chatWorkspaceState";
import { resolveInitialChatInstanceId } from "./chatInitialInstanceSelection";
import { normalizeChatReadinessProbe, unavailableChatReadiness, type ChatReadinessState } from "./chatReadinessState";

interface ChatInstanceLifecycleOptions {
  userId?: string;
  preferredInstanceId: string;
  selectedId: string;
  selectedIdRef: RefObject<string>;
  instanceGenerationRef: RefObject<number>;
  getRememberedInstanceId: () => string | null | undefined;
  selectInstanceId: (id: string) => void;
  setInstances: Dispatch<SetStateAction<AgentInstance[]>>;
  setLoadingInstances: Dispatch<SetStateAction<boolean>>;
  setChatReadiness: Dispatch<SetStateAction<Record<string, ChatReadinessState>>>;
  setError: Dispatch<SetStateAction<string | null>>;
  loadConversationsForSelectedInstance: (id: string, generation: number, signal?: AbortSignal) => Promise<void>;
}

/** Owns instance loading and readiness probes; selection remains an atomic workspace operation. */
export function useChatInstanceLifecycle({ userId, preferredInstanceId, selectedId, selectedIdRef, instanceGenerationRef, getRememberedInstanceId, selectInstanceId, setInstances, setLoadingInstances, setChatReadiness, setError, loadConversationsForSelectedInstance }: ChatInstanceLifecycleOptions) {
  const { t } = useTranslation(["dashboard", "common"]);
  // Load instances
  useEffect(() => {
    const controller = new AbortController();
    const currentUserScope = userId;
    if (!currentUserScope) return;
    selectInstanceId("");
    async function loadInstances() {
      try {
        setLoadingInstances(true);
        const data = await api.get("/api/instances", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (data && Array.isArray(data)) {
          // Filter to only running/ready instances
          const allowedStatuses = ["running", "gateway_ready", "partial_running", "dashboard_ready"];
          const activeList = data.filter((inst: AgentInstance) => {
            const status = String(inst.status || "").toLowerCase();
            const dashboardlessRuntime = inst.configSummary?.enableDashboard === false;
            return allowedStatuses.includes(status)
              || (dashboardlessRuntime && ["failed", "unhealthy"].includes(status));
          });
          setInstances(activeList);

          // Restore history immediately; runtime readiness only gates sending.
          const initialId = resolveInitialChatInstanceId(activeList, {}, preferredInstanceId, getRememberedInstanceId());
          selectInstanceId(initialId);

          // Other instances update independently and never change the selection.
          // The selected-instance effect owns its probe, avoiding a duplicate call.
          void (async () => {
            // Leave browser connections available for history and the active run.
            for (const inst of activeList) {
              if (controller.signal.aborted) return;
              if (inst.id === initialId || inst.id === selectedIdRef.current) continue;
              try {
                const probe = await api.get(`/api/instances/${inst.id}/chat-readiness`, { signal: controller.signal });
                if (controller.signal.aborted) return;
                if (selectedIdRef.current === inst.id) continue;
                setChatReadiness(previous => ({ ...previous, [inst.id]: normalizeChatReadinessProbe({ ...probe, checkedAt: new Date().toISOString(), probeStatus: "checked" }) }));
              } catch {
                if (controller.signal.aborted) return;
                if (selectedIdRef.current === inst.id) continue;
                setChatReadiness(previous => ({ ...previous, [inst.id]: { ...unavailableChatReadiness("PROBE_FAILED", t("dashboard:chatWorkspace.probeFailed")), checkedAt: new Date().toISOString(), probeStatus: "failed" } }));
              }
            }
          })();
        }
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error("Failed to fetch instances for chat workspace:", err);
        setError(t("dashboard:chatWorkspace.loadInstancesError"));
      } finally {
        if (!controller.signal.aborted) setLoadingInstances(false);
      }
    }
    loadInstances();
    return () => controller.abort();
  }, [userId]);


  // Poll/Refresh readiness of selected instance and load its conversations when selectedId changes
  useEffect(() => {
    if (!selectedId) return;

    const initialSelectedId = selectedId;
    const currentInstanceGen = instanceGenerationRef.current;
    const controller = new AbortController();

    async function checkCurrentReadiness() {
      try {
        // Probe readiness
        const probe = await api.get(`/api/instances/${selectedId}/chat-readiness`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: normalizeChatReadinessProbe({ ...probe, checkedAt: new Date().toISOString(), probeStatus: "checked" })
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        if (!shouldAcceptConversationHistory(
          { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
          { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
        )) return;
        setChatReadiness(prev => ({
          ...prev,
          [selectedId]: { ...unavailableChatReadiness("PROBE_FAILED", t("dashboard:chatWorkspace.probeFailed")), checkedAt: new Date().toISOString(), probeStatus: "failed" }
        }));
      }

    }

    // History is stored locally and remains readable even when a runtime is slow.
    void loadConversationsForSelectedInstance(initialSelectedId, currentInstanceGen, controller.signal);
    void checkCurrentReadiness();
    return () => controller.abort();
  }, [selectedId]);

}
