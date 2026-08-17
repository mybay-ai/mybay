import { describe, expect, it, vi } from "vitest";
import { createRunHermesSessionContextController } from "./runHermesSessionContext";

function createHarness(conversation: { session_id?: unknown; title?: string } | null) {
  const requestRuns = vi.fn(async () => ({
    ok: true,
    statusCode: 201,
    json: { session_id: "created-session" }
  }));
  const bindConversationSessionId = vi.fn(async () => true);
  const logFallback = vi.fn();
  const controller = createRunHermesSessionContextController({
    requestRuns,
    bindConversationSessionId,
    getConversationForSessionBinding: vi.fn(async () => conversation),
    logFallback,
    toReasoningModelOptions: (value) => ({ effort: value }),
    deduplicateHistoryEnabled: () => false,
    systemPolicy: "default policy"
  });
  return { controller, requestRuns, bindConversationSessionId, logFallback };
}

describe("runHermesSessionContext", () => {
  it("returns a trimmed existing native session without creating another", async () => {
    const { controller, requestRuns } = createHarness({ session_id: "  native-session  " });

    await expect(controller.ensureForConversation({
      instance_id: "instance-1",
      conversation_id: "conversation-1"
    })).resolves.toEqual({ sessionId: "native-session", state: "existing" });
    expect(requestRuns).not.toHaveBeenCalled();
  });

  it("recognizes the stable conversation fallback session", async () => {
    const { controller, requestRuns } = createHarness({ session_id: "mybay_conversation1" });

    await expect(controller.ensureForConversation({
      instance_id: "instance-1",
      conversation_id: "conversation-1"
    })).resolves.toEqual({ sessionId: "mybay_conversation1", state: "fallback" });
    expect(requestRuns).not.toHaveBeenCalled();
  });

  it("replaces a legacy generated session with a newly created native session", async () => {
    const { controller, requestRuns, bindConversationSessionId } = createHarness({
      session_id: "conv_conversation1",
      title: "Conversation title"
    });

    await expect(controller.ensureForConversation({
      instance_id: "instance-1",
      conversation_id: "conversation-1"
    })).resolves.toEqual({ sessionId: "created-session", state: "created" });
    expect(requestRuns).toHaveBeenCalledWith(expect.objectContaining({
      body: { title: "Conversation title" }
    }));
    expect(bindConversationSessionId).toHaveBeenCalledWith("conversation-1", "created-session");
  });

  it("fails before transport when the conversation no longer exists", async () => {
    const { controller, requestRuns } = createHarness(null);

    await expect(controller.ensureForConversation({
      instance_id: "instance-1",
      conversation_id: "conversation-1"
    })).rejects.toThrow("CONVERSATION_NOT_FOUND");
    expect(requestRuns).not.toHaveBeenCalled();
  });
});
