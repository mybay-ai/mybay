import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useChatHistoryPagination } from "./useChatHistoryPagination";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn() } }));
function options(): Parameters<typeof useChatHistoryPagination>[0] {
  return { selectedId: "agent-a", selectedConversationId: "conv-a", nextCursorSeq: 50, loadingMoreMessages: false,
    selectedIdRef: { current: "agent-a" }, selectedConversationIdRef: { current: "conv-a" }, messageGenerationRef: { current: 1 }, messageLoadRequestIdRef: { current: 0 },
    chatScroll: { pause: vi.fn(), prepareForPrepend: vi.fn() }, setLoadingMoreMessages: vi.fn(), setMessages: vi.fn(), setNextCursorSeq: vi.fn(), setError: vi.fn() };
}
describe("history pagination isolation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("ignores an old page after switching conversation", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockReturnValue(new Promise(done => { resolve = done; }));
    const input = options();
    const pending = useChatHistoryPagination(input).handleLoadMoreMessages();
    input.selectedConversationIdRef.current = "conv-b";
    resolve({ success: true, messages: [{ id: "old", role: "user" }], nextCursorSeq: null });
    await pending;
    expect(input.setMessages).not.toHaveBeenCalled();
    expect(input.chatScroll.prepareForPrepend).not.toHaveBeenCalled();
    expect(input.setNextCursorSeq).not.toHaveBeenCalled();
  });
  it("captures the scroll anchor only when the page arrives", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockReturnValue(new Promise(done => { resolve = done; }));
    const input = options();
    const pending = useChatHistoryPagination(input).handleLoadMoreMessages();
    expect(input.chatScroll.pause).toHaveBeenCalledOnce();
    expect(input.chatScroll.prepareForPrepend).not.toHaveBeenCalled();
    resolve({ success: true, messages: [], nextCursorSeq: null });
    await pending;
    expect(input.chatScroll.prepareForPrepend).toHaveBeenCalledOnce();
    expect(input.setNextCursorSeq).toHaveBeenCalledWith(null);
  });
});
