import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ index: 0, values: [] as any[] }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = state.index++;
    state.values[index] = index === 0 ? [{ id: "a", title: "Keep" }] : initial;
    return [state.values[index], (next: any) => { state.values[index] = typeof next === "function" ? next(state.values[index]) : next; }];
  },
}));
vi.mock("../../lib/api", () => ({ api: { put: vi.fn(), post: vi.fn() } }));
import { api } from "../../lib/api";
import { useChatConversations } from "./useChatConversations";
const placement = { conversationId: "a", targetId: null, section: { kind: "recent" as const }, position: "after" as const };
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  const options = { selectedId: "agent", selectedIdRef: { current: "agent" }, instanceGenerationRef: { current: 1 },
    selectedConversationIdRef: { current: "a" }, selectionRevisionRef: { current: 0 }, getRememberedConversationId: vi.fn(),
    selectConversationId: vi.fn(), setMessages: vi.fn(), setNextCursorSeq: vi.fn(), setError: vi.fn(), setPendingAttachments: vi.fn(),
    setConversationFiles: vi.fn(), showConfirm: vi.fn(), t: (key: string) => key };
  // eslint-disable-next-line react-hooks/rules-of-hooks -- callback-only harness; browser acceptance covers rendering.
  return { hook: useChatConversations(options as any), options };
}
describe("placement request lifecycle", () => {
  beforeEach(() => { state.index = 0; state.values = []; vi.clearAllMocks(); });
  it("serializes writes and adopts the complete server order only after success", async () => {
    const response = deferred(); vi.mocked(api.put).mockReturnValue(response.promise);
    const { hook } = setup();
    const first = hook.handlePlaceConversation(placement);
    await hook.handlePlaceConversation(placement);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(state.values[0]).toEqual([{ id: "a", title: "Keep" }]);
    response.resolve({ success: true, conversations: [{ id: "previously-unloaded", sort_order: 0 }, { id: "a", sort_order: 1 }] });
    await first;
    expect(state.values[0].map((c: any) => c.id)).toEqual(["previously-unloaded", "a"]);
    expect(state.values[3]).toBe(null); // Old pagination cursor is invalid after rank changes.
  });
  it("keeps the original order when the server refuses the save", async () => {
    vi.mocked(api.put).mockResolvedValue({ success: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { hook, options } = setup(); await hook.handlePlaceConversation(placement);
      expect(state.values[0]).toEqual([{ id: "a", title: "Keep" }]);
      expect(options.setError).toHaveBeenCalledWith("dashboard:chatWorkspace.reorderConversationFailed");
    } finally { log.mockRestore(); }
  });
  it("ignores stale instance responses and does not release a newer lock", async () => {
    const old = deferred(), current = deferred(); vi.mocked(api.put).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { hook, options } = setup();
    const oldWork = hook.handlePlaceConversation(placement);
    hook.resetConversationsForInstance(); options.instanceGenerationRef.current++;
    const currentWork = hook.handlePlaceConversation(placement);
    old.resolve({ success: true, conversations: [{ id: "obsolete" }] }); await oldWork;
    await hook.handlePlaceConversation(placement);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(state.values[0]).toEqual([]);
    current.resolve({ success: true, conversations: [{ id: "current" }] }); await currentWork;
    expect(state.values[0].map((c: any) => c.id)).toEqual(["current"]);
  });
  it("passes the selected project when creating a conversation from its header", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, conversation: { id: "new" } });
    const { hook } = setup(); await hook.handleCreateConversation("project");
    expect(api.post).toHaveBeenCalledWith("/api/instances/agent/conversations", expect.objectContaining({ projectId: "project" }));
  });
});
