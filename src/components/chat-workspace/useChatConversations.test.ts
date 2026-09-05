import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import { useChatConversations } from "./useChatConversations";

// Unit harness for asynchronous callbacks; real rendering is covered by browser acceptance.
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    let value = initial;
    return [value, (next: unknown) => { value = typeof next === "function" ? next(value) : next; }];
  },
}));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  const options = {
    selectedId: "agent-a", selectedIdRef: { current: "agent-a" },
    selectedConversationId: null, selectedConversationIdRef: { current: null as string | null },
    selectionRevisionRef: { current: 0 }, instanceGenerationRef: { current: 1 },
    getRememberedConversationId: vi.fn(() => null as string | null),
    selectConversationId: vi.fn(), setMessages: vi.fn(), setNextCursorSeq: vi.fn(),
    setError: vi.fn(), setPendingAttachments: vi.fn(), setConversationFiles: vi.fn(),
    showConfirm: vi.fn(async () => true), t: ((key: string) => key) as TFunction,
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks -- React is replaced by the callback-only unit harness above.
  return { options, hook: useChatConversations(options) };
}

describe("conversation selection request races", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("restores the conversation without waiting for slow project labels", async () => {
    const projects = deferred<any>();
    vi.mocked(api.get).mockImplementation(path => path.endsWith('conversation-projects')
      ? projects.promise : Promise.resolve({ success: true, conversations: [{ id: 'saved' }] }));
    const { hook, options } = setup();
    options.getRememberedConversationId.mockReturnValue('saved');
    await hook.loadConversationsForSelectedInstance('agent-a', 1);
    expect(options.selectConversationId).toHaveBeenCalledWith('saved');
    projects.resolve({ success: true, projects: [] });
  });

  it("discards the first A response after A -> B -> A, even if the instance ID matches again", async () => {
    const oldList = deferred<any>();
    vi.mocked(api.get).mockImplementation(path => path.endsWith("conversation-projects")
      ? Promise.resolve({ success: true, projects: [] }) : oldList.promise);
    const { hook, options } = setup();
    const first = hook.loadConversationsForSelectedInstance("agent-a", 1);
    options.instanceGenerationRef.current = 3;
    options.selectionRevisionRef.current = 2;
    vi.mocked(api.get).mockResolvedValue({ success: true, conversations: [{ id: "new-a" }] });
    await hook.loadConversationsForSelectedInstance("agent-a", 3);
    oldList.resolve({ success: true, conversations: [{ id: "old-a" }] });
    await first;
    expect(options.selectConversationId.mock.calls).toEqual([["new-a"]]);
  });

  it("does not replace a manual conversation selection with delayed saved-detail restoration", async () => {
    const detail = deferred<any>();
    const detailStarted = deferred<void>();
    vi.mocked(api.get).mockImplementation(path => {
      if (path.endsWith("conversation-projects")) return Promise.resolve({ success: true, projects: [] });
      if (path.includes("?limit=")) return Promise.resolve({ success: true, conversations: [{ id: "first" }] });
      detailStarted.resolve();
      return detail.promise;
    });
    const { hook, options } = setup();
    options.getRememberedConversationId.mockReturnValue("saved");
    const pending = hook.loadConversationsForSelectedInstance("agent-a", 1);
    await detailStarted.promise;
    options.selectionRevisionRef.current += 1;
    options.selectedConversationIdRef.current = "manually-selected";
    detail.resolve({ success: true, conversation: { id: "saved" } });
    await pending;
    expect(options.selectConversationId).not.toHaveBeenCalled();
    expect(options.setError).not.toHaveBeenCalled();
  });

  it.each(["abort", "switch"])("silences an obsolete list failure after %s", async mode => {
    const list = deferred<any>();
    vi.mocked(api.get).mockImplementation(path => path.endsWith("conversation-projects")
      ? Promise.resolve(null) : list.promise);
    const { hook, options } = setup();
    const controller = new AbortController();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const pending = hook.loadConversationsForSelectedInstance("agent-a", 1, controller.signal);
      if (mode === "abort") controller.abort();
      else { options.selectedIdRef.current = "agent-b"; options.instanceGenerationRef.current += 1; }
      list.reject(Object.assign(new Error("conversation not found"), { status: 404 }));
      await pending;
      expect(options.setError).not.toHaveBeenCalled();
      expect(options.selectConversationId).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      expect(vi.mocked(api.get).mock.calls.every(([, config]) => config?.signal === controller.signal)).toBe(true);
    } finally { log.mockRestore(); }
  });

  it("does not let a late create response hijack a newer conversation selection", async () => {
    const created = deferred<any>();
    vi.mocked(api.post).mockReturnValue(created.promise);
    const { hook, options } = setup();
    const pending = hook.handleCreateConversation();
    options.selectionRevisionRef.current += 1;
    created.resolve({ success: true, conversation: { id: "created-in-background" } });
    await pending;
    expect(options.selectConversationId).not.toHaveBeenCalled();
    expect(options.setMessages).not.toHaveBeenCalled();
  });
});


describe("pending conversation creation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("locks immediately, avoids duplicate creation and releases after selection", async () => {
    const response = deferred<any>();
    vi.mocked(api.post).mockReturnValue(response.promise);
    const { hook, options } = setup();
    const pending = hook.handleCreateConversation();
    expect(hook.conversationCreationInFlightRef.current).toBe(true);
    await hook.handleCreateConversation();
    expect(api.post).toHaveBeenCalledTimes(1);
    response.resolve({ success: true, conversation: { id: "new" } });
    await pending;
    expect(options.selectConversationId).toHaveBeenCalledWith("new");
    expect(hook.conversationCreationInFlightRef.current).toBe(false);
  });
  it("does not release a newer creation lock when an obsolete request finishes", async () => {
    const old = deferred<any>(), current = deferred<any>();
    vi.mocked(api.post).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { hook } = setup();
    const pendingOld = hook.handleCreateConversation();
    hook.resetConversationsForInstance();
    const pendingCurrent = hook.handleCreateConversation();
    old.resolve({ success: false });
    await pendingOld;
    expect(hook.conversationCreationInFlightRef.current).toBe(true);
    current.resolve({ success: false });
    await pendingCurrent;
    expect(hook.conversationCreationInFlightRef.current).toBe(false);
  });
  it("reports unsuccessful creation and releases sending without clearing attachments", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false });
    const { hook, options } = setup();
    await hook.handleCreateConversation();
    expect(hook.conversationCreationInFlightRef.current).toBe(false);
    expect(options.setPendingAttachments).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenCalledWith("dashboard:chatWorkspace.createConversationFailed");
  });
});
