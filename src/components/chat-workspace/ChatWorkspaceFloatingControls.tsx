import { ChevronRight, Layers } from "lucide-react";

interface ChatWorkspaceFloatingControlsProps {
  sidebarOpen: boolean;
  selectedInstanceId: string;
  mobileWorkspaceOpen: boolean;
  expandHistoryLabel: string;
  workspaceLabel: string;
  onOpenSidebar: () => void;
  onOpenMobileWorkspace: () => void;
}

export function ChatWorkspaceFloatingControls({
  sidebarOpen,
  selectedInstanceId,
  mobileWorkspaceOpen,
  expandHistoryLabel,
  workspaceLabel,
  onOpenSidebar,
  onOpenMobileWorkspace,
}: ChatWorkspaceFloatingControlsProps) {
  return (
    <>
      {!sidebarOpen && (
        <button
          type="button"
          onClick={onOpenSidebar}
          className="absolute left-2 top-2 p-1.5 bg-surface hover:bg-surface-muted text-content-muted hover:text-slate-700 border border-outline rounded-lg z-20 md:block hidden shadow-xs dark:hover:text-slate-100"
          title={expandHistoryLabel}
          aria-label={expandHistoryLabel}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
      {selectedInstanceId && (
        <button
          type="button"
          onClick={onOpenMobileWorkspace}
          className="xl:hidden absolute right-3 top-3 z-20 h-9 w-9 rounded-xl border border-outline bg-surface/95 text-content-secondary shadow-sm inline-flex items-center justify-center active:scale-95 transition-all"
          title={workspaceLabel}
          aria-label={workspaceLabel}
          aria-expanded={mobileWorkspaceOpen}
          aria-controls="mobile-chat-workspace-panel"
        >
          <Layers className="w-4 h-4" />
        </button>
      )}
    </>
  );
}
