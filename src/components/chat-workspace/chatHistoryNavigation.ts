export type ChatHistoryNavigation = {
  conversationId: string;
  messageId: string;
  sequenceNo: number;
  nonce: number;
  window: "search" | "latest-loading" | "latest";
};

export function getHistorySearchQuery(navigation: ChatHistoryNavigation | null) {
  return navigation?.window === "search" && Number.isFinite(navigation.sequenceNo)
    ? `&beforeSeq=${encodeURIComponent(String(navigation.sequenceNo + 1))}`
    : "";
}

export function needsLatestHistoryWindow(navigation: ChatHistoryNavigation | null) {
  return navigation !== null && navigation.window !== "latest";
}

// Keep the window pending until an accepted response succeeds, so a failed
// request can be retried rather than treating the truncated search page as latest.
export function requestLatestHistoryWindow(navigation: ChatHistoryNavigation | null, conversationId: string | null) {
  if (!navigation || navigation.conversationId !== conversationId || !needsLatestHistoryWindow(navigation)) return navigation;
  return { ...navigation, window: "latest-loading" as const, nonce: navigation.nonce + 1 };
}

export function completeLatestHistoryWindow(navigation: ChatHistoryNavigation | null, request: ChatHistoryNavigation | null) {
  if (!navigation || request?.window !== "latest-loading" || navigation.conversationId !== request.conversationId || navigation.nonce !== request.nonce || navigation.window !== "latest-loading") return navigation;
  return { ...navigation, window: "latest" as const };
}
