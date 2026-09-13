import { CHAT_WORKSPACE_TABLET_BREAKPOINT } from "./chatWorkspaceResponsiveLayout";

interface SelectionRef<T> {
  current: T;
}

interface ChatComposerInteractionOptions {
  selectedIdRef: SelectionRef<string>;
  selectedConversationIdRef: SelectionRef<string | null>;
  handleUploadFiles: (files: FileList | File[]) => void | Promise<void>;
  getViewportWidth?: () => number | null;
  requestFrame?: (callback: () => void) => void;
  scrollToTop?: () => void;
}

function readViewportWidth() {
  return typeof window === "undefined" ? null : window.innerWidth;
}

function requestBrowserFrame(callback: () => void) {
  window.requestAnimationFrame(callback);
}

function scrollBrowserToTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function createChatComposerInteractionActions({
  selectedIdRef,
  selectedConversationIdRef,
  handleUploadFiles,
  getViewportWidth = readViewportWidth,
  requestFrame = requestBrowserFrame,
  scrollToTop = scrollBrowserToTop,
}: ChatComposerInteractionOptions) {
  const handleAddWorkspaceFiles = (instanceId: string, conversationId: string, files: File[]) => {
    if (selectedIdRef.current !== instanceId || selectedConversationIdRef.current !== conversationId) return false;
    void handleUploadFiles(files);
    return true;
  };

  const handleComposerInputFocus = () => {
    const viewportWidth = getViewportWidth();
    if (viewportWidth === null || viewportWidth >= CHAT_WORKSPACE_TABLET_BREAKPOINT) return false;
    requestFrame(scrollToTop);
    return true;
  };

  return { handleAddWorkspaceFiles, handleComposerInputFocus };
}
