import type { TFunction } from "i18next";
import type { WorkspaceTab } from "./ChatWorkspacePanel";
import type { ComposerCommandId } from "./chatComposerSuggestions";

type ToastType = "success" | "error" | "warning" | "info";

interface ChatComposerCommandOptions {
  runtimeType?: string | null;
  handleCreateConversation: () => void | Promise<unknown>;
  handleClear: () => void | Promise<unknown>;
  handleCancelOrStop: () => void | Promise<unknown>;
  setDesktopWorkspaceTab: (tab: WorkspaceTab) => void;
  selectMobileWorkspaceTab: (tab: WorkspaceTab) => void;
  revealMobileWorkspaceTabOnNarrowViewport: (tab: WorkspaceTab) => boolean;
  closeMobileOverlay: () => void;
  setShowSettings: (show: boolean) => void;
  showToast: (message: string, type?: ToastType) => void;
  t: TFunction;
}

export function resolveComposerCommandHelpKey(runtimeType?: string | null) {
  return String(runtimeType || "hermes").trim().toLowerCase() === "pi"
    ? "dashboard:chatWorkspace.composerCommandHelpMessagePi"
    : "dashboard:chatWorkspace.composerCommandHelpMessage";
}

export function createChatComposerCommandActions({
  runtimeType,
  handleCreateConversation,
  handleClear,
  handleCancelOrStop,
  setDesktopWorkspaceTab,
  selectMobileWorkspaceTab,
  revealMobileWorkspaceTabOnNarrowViewport,
  closeMobileOverlay,
  setShowSettings,
  showToast,
  t,
}: ChatComposerCommandOptions) {
  const openWorkspaceTab = (tab: WorkspaceTab) => {
    setDesktopWorkspaceTab(tab);
    selectMobileWorkspaceTab(tab);
    if (revealMobileWorkspaceTabOnNarrowViewport(tab)) setShowSettings(false);
  };

  const handleComposerCommand = (command: ComposerCommandId) => {
    switch (command) {
      case "new":
        void handleCreateConversation();
        return;
      case "clear":
        void handleClear();
        return;
      case "files":
        openWorkspaceTab("files");
        return;
      case "status":
        openWorkspaceTab("steps");
        return;
      case "stop":
        void handleCancelOrStop();
        return;
      case "model":
        closeMobileOverlay();
        setShowSettings(true);
        return;
      case "help":
        showToast(t(resolveComposerCommandHelpKey(runtimeType)), "info");
        return;
      case "agents":
      case "call":
      case "all":
        return;
    }
  };

  return { handleComposerCommand };
}
