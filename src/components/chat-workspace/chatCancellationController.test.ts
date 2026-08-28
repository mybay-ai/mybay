import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatCancellationController } from "./chatCancellationController";

describe("chat cancellation controller", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("releases the Agent UI as soon as the local stop request is accepted", async () => {
    const timers: Array<() => void> = [];
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: vi.fn(),
    });

    let releaseStatusPoll!: () => void;
    const waitForRunRelease = vi.fn(() => new Promise<any>((resolve) => {
      releaseStatusPoll = () => resolve({ released: true, status: "cancelled" });
    }));
    const stopActiveRunStreams = vi.fn();
    const finalizeActiveRunUi = vi.fn();
    const setSending = vi.fn();
    const setActiveRunConversationId = vi.fn();

    const controller = createChatCancellationController({
      activeRunId: "run-1",
      runExecutionState: {
        runId: "run-1",
        conversationId: "conversation-1",
        status: "running",
        blocks: [],
        lastProcessedSeq: 0,
      },
      activeSyncChatRequestRef: { current: null },
      activeChatGenerationRef: { current: 0 },
      activeChatRequestIdRef: { current: "request-1" },
      optimisticChatContextRef: { current: null },
      syncCancelReconciliationTimersRef: { current: [] },
      selectedIdRef: { current: "instance-1" },
      selectedConversationIdRef: { current: "conversation-1" },
      refreshAuthoritativeHistoryRef: { current: vi.fn().mockResolvedValue(undefined) },
      setMessages: vi.fn(),
      setSending,
      setActiveRunConversationId,
      handleStopRun: vi.fn().mockResolvedValue({ ok: true, status: "stopping" }),
      waitForRunRelease,
      isCurrentRunContext: () => true,
      stopActiveRunStreams,
      finalizeActiveRunUi,
      t: (key: string) => key,
    });

    await controller.handleCancelOrStop();

    expect(stopActiveRunStreams).toHaveBeenCalledOnce();
    expect(finalizeActiveRunUi).toHaveBeenCalledWith("run-1", "stopped");
    expect(setActiveRunConversationId).toHaveBeenCalledWith(null);
    expect(setSending).toHaveBeenCalledWith(false);
    expect(waitForRunRelease).toHaveBeenCalledOnce();

    releaseStatusPoll();
    await Promise.resolve();
  });
});
