import { useTranslation } from "react-i18next";
import type { A2ARetryNavigationState } from "./a2aRetryNavigation";

interface ChatWorkspaceRecoveryDraftNoticeProps {
  selectedInstanceId: string;
  input: string;
  blockCount: number;
  chatMode: "quick" | "assist" | "agent";
  recoveryDraft: A2ARetryNavigationState | null;
}

export function resolveRecoveryDraftNoticeKey({
  selectedInstanceId,
  input,
  blockCount,
  chatMode,
  recoveryDraft,
}: ChatWorkspaceRecoveryDraftNoticeProps): string | null {
  if (!selectedInstanceId || !input.trim() || recoveryDraft?.a2aRetryInstanceId !== selectedInstanceId || !recoveryDraft.a2aRecoverySource) return null;
  return input.trim() === recoveryDraft.a2aRetryDraft && blockCount === 0 && chatMode === "agent"
    ? "a2a.draftLinkedHint"
    : "a2a.draftUnlinkedHint";
}

export function ChatWorkspaceRecoveryDraftNotice(props: ChatWorkspaceRecoveryDraftNoticeProps) {
  const { t } = useTranslation("dashboard");
  const key = resolveRecoveryDraftNoticeKey(props);
  if (!key) return null;
  return (
    <div role="status" className="mx-4 mb-2 rounded-lg border border-outline bg-surface-muted px-3 py-2 text-xs leading-5 text-content-secondary">
      {t(key)}
    </div>
  );
}
