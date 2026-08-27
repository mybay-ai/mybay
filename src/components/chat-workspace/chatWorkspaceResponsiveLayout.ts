export const CHAT_WORKSPACE_TABLET_BREAKPOINT = 768;
export const CHAT_WORKSPACE_DESKTOP_BREAKPOINT = 1280;

export type ChatWorkspaceLayoutMode = "mobile" | "tablet" | "desktop";

export function resolveChatWorkspaceLayoutMode(viewportWidth: number): ChatWorkspaceLayoutMode {
  if (viewportWidth < CHAT_WORKSPACE_TABLET_BREAKPOINT) return "mobile";
  if (viewportWidth < CHAT_WORKSPACE_DESKTOP_BREAKPOINT) return "tablet";
  return "desktop";
}

export function shouldUseOverlayWorkspace(viewportWidth: number): boolean {
  return resolveChatWorkspaceLayoutMode(viewportWidth) !== "desktop";
}
