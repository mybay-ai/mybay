import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import type { GroupRunActivity, GroupRunMissingMember } from "./ChatGroupRunSummary";
import { readA2ARetryNavigationState, type A2ARetryNavigationState } from "./a2aRetryNavigation";

interface ModePreference {
  remember: (instanceId: string, mode: "quick" | "agent") => void;
}

interface UseA2ARecoveryDraftOptions {
  selectedId: string;
  setInput: (value: string) => void;
  setChatMode: Dispatch<SetStateAction<"quick" | "assist" | "agent">>;
  modePreference: ModePreference;
  showToast: (message: string, type?: "success" | "error" | "warning" | "info") => void;
}

/** Owns navigation-provided and user-requested A2A recovery drafts. */
export function useA2ARecoveryDraft({
  selectedId,
  setInput,
  setChatMode,
  modePreference,
  showToast,
}: UseA2ARecoveryDraftOptions) {
  const { t } = useTranslation(["dashboard", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const recoveryDraftRef = useRef<A2ARetryNavigationState | null>(null);
  const consumedLocationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId || consumedLocationRef.current === location.key) return;
    const retryState = readA2ARetryNavigationState(location.state, selectedId);
    if (!retryState) return;
    consumedLocationRef.current = location.key;
    recoveryDraftRef.current = retryState;
    setInput(retryState.a2aRetryDraft);
    setChatMode("agent");
    modePreference.remember(selectedId, "agent");
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
  }, [location.hash, location.key, location.pathname, location.search, location.state, modePreference, navigate, selectedId, setInput, setChatMode]);

  const prepareGroupRecovery = useCallback((activity: GroupRunActivity) => {
    if (!selectedId || !activity.peerId) return;
    const draft = t("dashboard:a2a.recoveryDraft", {
      peerId: activity.peerId,
      contextId: activity.contextId,
      taskId: activity.taskId,
      status: activity.status,
      request: activity.requestText || t("dashboard:a2a.recoveryRequestPlaceholder"),
      summary: activity.requestText ? "" : activity.summary || "",
    });
    recoveryDraftRef.current = {
      a2aRetryDraft: draft,
      a2aRetryInstanceId: selectedId,
      a2aRecoverySource: { contextId: activity.contextId, taskId: activity.taskId, peerId: activity.peerId },
    };
    setInput(draft);
    setChatMode("agent");
    modePreference.remember(selectedId, "agent");
    showToast(t("dashboard:chatWorkspace.groupRunRecoveryPrepared"), "success");
  }, [modePreference, selectedId, setChatMode, setInput, showToast, t]);

  const prepareMissingGroupMember = useCallback((member: GroupRunMissingMember) => {
    if (!selectedId) return;
    const draft = t("dashboard:chatWorkspace.groupRunMissingDraft", {
      peerName: member.peerName,
      peerId: member.peerId,
      contextId: member.contextId,
      request: member.requestText || t("dashboard:a2a.recoveryRequestPlaceholder"),
    });
    recoveryDraftRef.current = null;
    setInput(draft);
    setChatMode("agent");
    modePreference.remember(selectedId, "agent");
    showToast(t("dashboard:chatWorkspace.groupRunMissingPrepared"), "success");
  }, [modePreference, selectedId, setChatMode, setInput, showToast, t]);

  return { recoveryDraftRef, prepareGroupRecovery, prepareMissingGroupMember };
}
