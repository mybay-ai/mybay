import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { ChatWorkspacePanel, type WorkspaceTab } from "./ChatWorkspacePanel";

export type ChatWorkspacePanelSharedProps = Omit<
  ComponentProps<typeof ChatWorkspacePanel>,
  "variant" | "activeTab" | "onActiveTabChange"
>;

interface ChatMobileWorkspaceDialogProps {
  activeTab: WorkspaceTab;
  onActiveTabChange: (tab: WorkspaceTab) => void;
  onClose: () => void;
  dialogLabel: string;
  closeLabel: string;
  panelProps: ChatWorkspacePanelSharedProps;
}

export function ChatMobileWorkspaceDialog({
  activeTab,
  onActiveTabChange,
  onClose,
  dialogLabel,
  closeLabel,
  panelProps,
}: ChatMobileWorkspaceDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[80] flex min-h-0 flex-col overflow-hidden bg-surface xl:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[90] h-9 w-9 rounded-full border border-outline bg-surface text-content-muted hover:text-content inline-flex items-center justify-center shadow-sm"
        aria-label={closeLabel}
      >
        <X className="w-4 h-4" />
      </button>
      <ChatWorkspacePanel
        {...panelProps}
        variant="mobile"
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
      />
    </div>
  );
}
