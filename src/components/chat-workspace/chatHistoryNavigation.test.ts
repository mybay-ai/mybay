import { describe, expect, it } from "vitest";
import { reconcileConversationMessages, shouldAcceptMessageHistory, type ChatMessage } from "../../lib/chatWorkspaceState";
import { completeLatestHistoryWindow, getHistorySearchQuery, needsLatestHistoryWindow, requestLatestHistoryWindow, type ChatHistoryNavigation } from "./chatHistoryNavigation";

const search: ChatHistoryNavigation = { conversationId: "conversation-a", messageId: "old-user", sequenceNo: 1, nonce: 10, window: "search" };

describe("returning from a search window to latest history", () => {
  it("limits search history through the matched message only", () => {
    expect(getHistorySearchQuery(search)).toBe("&beforeSeq=2");
    expect(getHistorySearchQuery(null)).toBe("");
    expect(getHistorySearchQuery({ ...search, sequenceNo: NaN })).toBe("");
  });

  it("requests the latest window and restores newer replies missing from search", () => {
    const stored: ChatMessage[] = [
      { id: "old-user", conversation_id: "conversation-a", role: "user", sequence_no: 1, content: "Find this" },
      { id: "newer-reply", conversation_id: "conversation-a", role: "assistant", sequence_no: 2, content: "Line 80" },
    ];
    const loadPage = (navigation: ChatHistoryNavigation) => {
      const query = new URLSearchParams(`limit=50${getHistorySearchQuery(navigation)}`);
      return query.has("beforeSeq") ? stored.filter(m => m.sequence_no! < Number(query.get("beforeSeq"))) : stored;
    };
    const searchPage = loadPage(search);
    expect(searchPage.map(m => m.id)).toEqual(["old-user"]);
    const requested = requestLatestHistoryWindow(search, "conversation-a")!;
    expect(requested.window).toBe("latest-loading");
    expect(requested.nonce).toBeGreaterThan(search.nonce);
    expect(getHistorySearchQuery(requested)).toBe("");
    const rendered = reconcileConversationMessages(loadPage(requested), searchPage, null, "conversation-a");
    expect(rendered.map(m => m.id)).toEqual(["old-user", "newer-reply"]);
    const completed = completeLatestHistoryWindow(requested, requested)!;
    expect(completed.window).toBe("latest");
    expect(completed.nonce).toBe(requested.nonce); // Do not trigger another load on success.
    expect(needsLatestHistoryWindow(completed)).toBe(false);
    expect(requestLatestHistoryWindow(completed, "conversation-a")).toBe(completed);
  });

  it("keeps a retryable latest window when loading fails", () => {
    const pending = requestLatestHistoryWindow(search, "conversation-a")!;
    // No completion is applied on rejection; the return control remains available.
    expect(needsLatestHistoryWindow(pending)).toBe(true);
    const retry = requestLatestHistoryWindow(pending, "conversation-a")!;
    expect(retry.nonce).toBe(pending.nonce + 1);
    expect(getHistorySearchQuery(retry)).toBe("");
    expect(completeLatestHistoryWindow(retry, pending)).toBe(retry);
    expect(completeLatestHistoryWindow(retry, retry)?.window).toBe("latest");
  });

  it("does not complete a latest request with an obsolete search response", () => {
    const pending = requestLatestHistoryWindow(search, "conversation-a")!;
    expect(completeLatestHistoryWindow(pending, search)).toBe(pending);
    expect(completeLatestHistoryWindow(pending, { ...search, nonce: pending.nonce })).toBe(pending);
  });

  it("does not resurrect a cleared search or change another conversation", () => {
    const pending = requestLatestHistoryWindow(search, "conversation-a")!;
    expect(requestLatestHistoryWindow(search, "conversation-b")).toBe(search);
    expect(requestLatestHistoryWindow(null, "conversation-a")).toBeNull();
    expect(needsLatestHistoryWindow(null)).toBe(false);
    expect(completeLatestHistoryWindow(null, pending)).toBeNull();
    const other = { ...pending, conversationId: "conversation-b" };
    expect(completeLatestHistoryWindow(other, pending)).toBe(other);
  });

  it.each([
    { selectedId: "another-instance" },
    { selectedConversationId: "another-conversation" },
    { messageGeneration: 2 },
    { historyRequestId: 12 },
  ])("rejects stale history before applying messages or completing navigation: %o", change => {
    const bound = { selectedId: "instance-a", selectedConversationId: "conversation-a", messageGeneration: 1, historyRequestId: 11 };
    expect(shouldAcceptMessageHistory({ ...bound, ...change }, bound)).toBe(false);
    expect(shouldAcceptMessageHistory(bound, bound)).toBe(true);
  });
});
