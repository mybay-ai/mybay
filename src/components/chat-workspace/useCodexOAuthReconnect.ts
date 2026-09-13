import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import type { AgentInstance } from "../../types";
import { useProviderOAuth } from "../../features/deploy/useProviderOAuth";
import { normalizeChatReadinessProbe, type ChatReadinessState } from "./chatReadinessState";
import { isCodexChatGPTAccountInstance } from "./chatInstancePresentation";

interface UseCodexOAuthReconnectOptions {
  selectedId: string;
  selectedInstance?: AgentInstance;
  setInstances: Dispatch<SetStateAction<AgentInstance[]>>;
  setChatReadiness: Dispatch<SetStateAction<Record<string, ChatReadinessState>>>;
  showToast: (message: string, type?: "success" | "error" | "warning" | "info") => void;
  t: TFunction;
}

export function useCodexOAuthReconnect({
  selectedId,
  selectedInstance,
  setInstances,
  setChatReadiness,
  showToast,
  t,
}: UseCodexOAuthReconnectOptions) {
  const reconnectInstanceIdRef = useRef<string | null>(null);
  const isCodexAccountInstance = isCodexChatGPTAccountInstance(selectedInstance);
  const codexOAuth = useProviderOAuth({
    provider: "openai-codex",
    enabled: isCodexAccountInstance,
    onComplete: async credential => {
      const targetInstanceId = reconnectInstanceIdRef.current;
      if (!targetInstanceId) throw new Error(t("dashboard:chatWorkspace.codexOAuthReconnectFailed"));
      await api.post(`/api/instances/${encodeURIComponent(targetInstanceId)}/codex-oauth`, { credentialId: credential.id });
      setInstances(previous => previous.map(instance => instance.id === targetInstanceId ? {
        ...instance,
        model_provider: "openai-codex",
        configSummary: {
          ...(instance.configSummary || {}),
          provider: "openai",
          providerCredentialId: credential.id,
        },
      } : instance));
      const probe = await api.get(`/api/instances/${encodeURIComponent(targetInstanceId)}/chat-readiness`);
      setChatReadiness(previous => ({
        ...previous,
        [targetInstanceId]: normalizeChatReadinessProbe({
          ...probe,
          checkedAt: new Date().toISOString(),
          probeStatus: "checked",
        }),
      }));
      showToast(t("dashboard:chatWorkspace.codexOAuthReconnected"), "success");
    },
  });

  useEffect(() => {
    if (codexOAuth.error) showToast(t("dashboard:chatWorkspace.codexOAuthReconnectFailed"), "error");
  }, [codexOAuth.error, showToast, t]);

  const handleReconnectCodexOAuth = useCallback(() => {
    if (!selectedId || !isCodexAccountInstance) return;
    reconnectInstanceIdRef.current = selectedId;
    void codexOAuth.connect();
  }, [codexOAuth.connect, isCodexAccountInstance, selectedId]);

  return {
    isCodexAccountInstance,
    reconnectingCodexOAuth: codexOAuth.loading,
    handleReconnectCodexOAuth,
  };
}
