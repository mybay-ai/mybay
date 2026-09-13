import type { ConversationSearchResult } from "../../../shared/conversationSearch";
import type { ChatHistoryNavigation } from "./chatHistoryNavigation";

interface ChatWorkspaceNavigationOptions {
  deployRoute: string;
  navigate: (route: string) => void;
  handleCreateConversation: (projectId?: string | null) => void | Promise<unknown>;
  selectInstanceId: (instanceId: string) => void;
  selectConversationId: (conversationId: string) => void;
  openMobileHistory: () => void;
  openMobileWorkspace: () => void;
  closeMobileOverlay: () => void;
  closeMobileOverlayAndResetWorkspace: () => void;
  setShowSettings: (value: boolean | ((current: boolean) => boolean)) => void;
  setSidebarOpen: (value: boolean) => void;
  setMessages: (messages: []) => void;
  setError: (error: null) => void;
  setSearchNavigation: (navigation: ChatHistoryNavigation | null) => void;
  now?: () => number;
}

export function createChatWorkspaceNavigationActions({
  deployRoute,
  navigate,
  handleCreateConversation,
  selectInstanceId,
  selectConversationId,
  openMobileHistory,
  openMobileWorkspace,
  closeMobileOverlay,
  closeMobileOverlayAndResetWorkspace,
  setShowSettings,
  setSidebarOpen,
  setMessages,
  setError,
  setSearchNavigation,
  now = Date.now,
}: ChatWorkspaceNavigationOptions) {
  const handleOpenMobileHistory = () => {
    setShowSettings(false);
    openMobileHistory();
  };

  const handleDeployNewInstance = () => navigate(deployRoute);

  const handleInstanceChange = (instanceId: string) => {
    selectInstanceId(instanceId);
    setMessages([]);
    setError(null);
    closeMobileOverlayAndResetWorkspace();
  };

  const handleToggleSettings = () => {
    closeMobileOverlay();
    setShowSettings(current => !current);
  };

  const handleCreateConversationFromSidebar = (projectId?: string | null) => {
    void handleCreateConversation(projectId ?? null);
    closeMobileOverlay();
  };

  const handleSelectConversation = (conversationId: string) => {
    setSearchNavigation(null);
    selectConversationId(conversationId);
    closeMobileOverlay();
  };

  const handleSelectSearchResult = (result: ConversationSearchResult) => {
    if (result.message_id && Number.isFinite(result.sequence_no)) {
      setSearchNavigation({
        conversationId: result.conversation_id,
        messageId: result.message_id,
        sequenceNo: Number(result.sequence_no),
        nonce: now(),
        window: "search",
      });
    } else {
      setSearchNavigation(null);
    }
    selectConversationId(result.conversation_id);
    closeMobileOverlay();
  };

  const handleOpenSidebar = () => setSidebarOpen(true);

  const handleOpenMobileWorkspace = () => {
    setShowSettings(false);
    openMobileWorkspace();
  };

  return {
    handleOpenMobileHistory,
    handleDeployNewInstance,
    handleInstanceChange,
    handleToggleSettings,
    handleCreateConversationFromSidebar,
    handleSelectConversation,
    handleSelectSearchResult,
    handleOpenSidebar,
    handleOpenMobileWorkspace,
  };
}
