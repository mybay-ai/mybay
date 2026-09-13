import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useChatMessageHistory } from "./useChatMessageHistory";
import { createChatSelectionPersistence } from "./chatSelectionPersistence";
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn() } }));
function options(): Parameters<typeof useChatMessageHistory>[0] {
  return {
    selectedId: "agent-a", selectedConversationId: "conversation-a", searchNavigation: null,
    selectedIdRef: { current: "agent-a" }, selectedConversationIdRef: { current: "conversation-a" },
    messageGenerationRef: { current: 1 }, messageLoadRequestIdRef: { current: 0 }, instanceGenerationRef: { current: 1 },
    historyAbortRef: { current: null }, optimisticChatContextRef: { current: null },
    setMessages: vi.fn(), setNextCursorSeq: vi.fn(), setLoadingMessages: vi.fn(), setError: vi.fn(), setSending: vi.fn(),
    setActiveRunConversationId: vi.fn(), setSearchNavigation: vi.fn(), selectionPersistence: createChatSelectionPersistence(() => null, "test-user"),
    selectConversationId: vi.fn(), loadConversationsForSelectedInstance: vi.fn(async () => {}),
    setActiveRunId: vi.fn(), setRunMetrics: vi.fn(), initializeRunExecution: vi.fn(), streamActiveRun: vi.fn(async () => {}),
    stopActiveRunStreams: vi.fn(), resetRunState: vi.fn(),
  };
}
describe("history load context isolation", () => {
  beforeEach(() => { effects.length = 0; vi.clearAllMocks(); });
  it("does not restore an old active run after the selection changes", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(done => { resolve = done; });
    vi.mocked(api.get).mockReturnValue(pending);
    const input = options();
    useChatMessageHistory(input);
    const cleanup = effects[0]();
    input.selectedConversationIdRef.current = "conversation-b";
    resolve({ success: true, messages: [], activeRun: { id: "old-run" } });
    await pending;
    expect(input.setMessages).not.toHaveBeenCalled();
    expect(input.initializeRunExecution).not.toHaveBeenCalled();
    expect(input.streamActiveRun).not.toHaveBeenCalled();
    if (cleanup) cleanup();
  });
  it("aborts on cleanup and ignores a late response", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise(done => { resolve = done; });
    vi.mocked(api.get).mockReturnValue(pending);
    const input = options();
    useChatMessageHistory(input);
    const cleanup = effects[0]();
    const controller = input.historyAbortRef.current;
    if (cleanup) cleanup();
    expect(controller?.signal.aborted).toBe(true);
    expect(input.historyAbortRef.current).toBeNull();
    resolve({ success: true, messages: [], activeRun: { id: "old-run" } });
    await pending;
    expect(input.setMessages).not.toHaveBeenCalled();
    expect(input.initializeRunExecution).not.toHaveBeenCalled();
  });
});
