import { useCallback, useReducer } from "react";
import type { WorkspaceTab } from "./ChatWorkspacePanel";
import { shouldUseOverlayWorkspace } from "./chatWorkspaceResponsiveLayout";

export type ChatMobileOverlay = "history" | "workspace" | null;

export interface ChatMobileWorkspaceState {
  overlay: ChatMobileOverlay;
  workspaceTab: WorkspaceTab;
}

export type ChatMobileWorkspaceAction =
  | { type: "open-history" }
  | { type: "open-workspace"; tab?: WorkspaceTab }
  | { type: "close-overlay" }
  | { type: "close-and-reset-workspace" }
  | { type: "select-workspace-tab"; tab: WorkspaceTab };

export const initialChatMobileWorkspaceState: ChatMobileWorkspaceState = {
  overlay: null,
  workspaceTab: "result",
};

export function reduceChatMobileWorkspace(
  state: ChatMobileWorkspaceState,
  action: ChatMobileWorkspaceAction,
): ChatMobileWorkspaceState {
  switch (action.type) {
    case "open-history":
      return { ...state, overlay: "history" };
    case "open-workspace":
      return {
        overlay: "workspace",
        workspaceTab: action.tab ?? state.workspaceTab,
      };
    case "close-overlay":
      return { ...state, overlay: null };
    case "close-and-reset-workspace":
      return initialChatMobileWorkspaceState;
    case "select-workspace-tab":
      return { ...state, workspaceTab: action.tab };
  }
}

interface UseChatMobileWorkspaceOptions {
  getViewportWidth?: () => number | null;
}

function readViewportWidth() {
  return typeof window === "undefined" ? null : window.innerWidth;
}

export function useChatMobileWorkspace({
  getViewportWidth = readViewportWidth,
}: UseChatMobileWorkspaceOptions = {}) {
  const [state, dispatch] = useReducer(reduceChatMobileWorkspace, initialChatMobileWorkspaceState);

  const openMobileHistory = useCallback(() => {
    dispatch({ type: "open-history" });
  }, []);

  const openMobileWorkspace = useCallback((tab?: WorkspaceTab) => {
    dispatch({ type: "open-workspace", tab });
  }, []);

  const closeMobileOverlay = useCallback(() => {
    dispatch({ type: "close-overlay" });
  }, []);

  const closeMobileOverlayAndResetWorkspace = useCallback(() => {
    dispatch({ type: "close-and-reset-workspace" });
  }, []);

  const selectMobileWorkspaceTab = useCallback((tab: WorkspaceTab) => {
    dispatch({ type: "select-workspace-tab", tab });
  }, []);

  const revealMobileWorkspaceTabOnNarrowViewport = useCallback((tab: WorkspaceTab) => {
    const viewportWidth = getViewportWidth();
    if (viewportWidth === null || !shouldUseOverlayWorkspace(viewportWidth)) return false;
    dispatch({ type: "open-workspace", tab });
    return true;
  }, [getViewportWidth]);

  return {
    mobileOverlay: state.overlay,
    mobileSidebarOpen: state.overlay === "history",
    mobileWorkspaceOpen: state.overlay === "workspace",
    mobileWorkspaceTab: state.workspaceTab,
    openMobileHistory,
    openMobileWorkspace,
    closeMobileOverlay,
    closeMobileOverlayAndResetWorkspace,
    selectMobileWorkspaceTab,
    revealMobileWorkspaceTabOnNarrowViewport,
  };
}
