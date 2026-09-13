import { useCallback, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import type { AgentInstance } from "../../types";
import { getChatInstanceDropdownLabel, groupChatInstances } from "./chatInstancePresentation";
import { normalizeChatReadinessProbe, type ChatReadinessState } from "./chatReadinessState";
import { useCodexOAuthReconnect } from "./useCodexOAuthReconnect";

interface UseChatInstanceReadinessOptions {
  instances: AgentInstance[];
  selectedId: string;
  selectedIdRef: RefObject<string>;
  setInstances: Dispatch<SetStateAction<AgentInstance[]>>;
  showToast: (message: string, type?: "success" | "error" | "warning" | "info") => void;
  t: TFunction;
}

/** Owns readiness state and the derived instance presentation used by the chat workspace. */
export function useChatInstanceReadiness({
  instances,
  selectedId,
  selectedIdRef,
  setInstances,
  showToast,
  t,
}: UseChatInstanceReadinessOptions) {
  const [chatReadiness, setChatReadiness] = useState<Record<string, ChatReadinessState>>({});
  const selectedReadiness = chatReadiness[selectedId];
  const selectedInstance = instances.find(instance => instance.id === selectedId);

  const handleReadinessChecked = useCallback((probe: Parameters<typeof normalizeChatReadinessProbe>[0]) => {
    if (!selectedId || selectedIdRef.current !== selectedId) return;
    setChatReadiness(previous => ({
      ...previous,
      [selectedId]: normalizeChatReadinessProbe(probe),
    }));
  }, [selectedId, selectedIdRef]);

  const groupedInstances = useMemo(
    () => groupChatInstances(instances, chatReadiness),
    [instances, chatReadiness],
  );
  const getInstanceDropdownLabel = useCallback(
    (instance: AgentInstance) => getChatInstanceDropdownLabel(instance, chatReadiness, t),
    [chatReadiness, t],
  );

  const {
    isCodexAccountInstance,
    reconnectingCodexOAuth,
    handleReconnectCodexOAuth,
  } = useCodexOAuthReconnect({
    selectedId,
    selectedInstance,
    setInstances,
    setChatReadiness,
    showToast,
    t,
  });

  return {
    chatReadiness,
    setChatReadiness,
    selectedReadiness,
    selectedInstance,
    isChatReady: selectedReadiness?.ready === true,
    hasAnyReady: Object.values(chatReadiness).some(readiness => readiness.ready),
    groupedInstances,
    getInstanceDropdownLabel,
    handleReadinessChecked,
    isCodexAccountInstance,
    reconnectingCodexOAuth,
    handleReconnectCodexOAuth,
  };
}
