import { beforeEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  requestTraefikInternal: vi.fn(),
  bindConversationSessionId: vi.fn()
}));

vi.mock("../../../db", () => ({ dbAdapter: { getInstanceById: external.getInstanceById } }));
vi.mock("../../../utils/instanceInternalApiKey", () => ({
  resolveInstanceInternalApiKey: () => ({ ok: true, apiKey: "internal-key" })
}));
vi.mock("../../../utils/traefikInternalRequest", () => ({
  requestTraefikInternal: external.requestTraefikInternal
}));
vi.mock("../../../utils/traefikInternalSse", () => ({ streamTraefikInternalSse: vi.fn() }));
vi.mock("../../../repositories/chatRepo", () => ({
  chatRepo: { bindConversationSessionId: external.bindConversationSessionId }
}));

import { hermesRuntimeDriver } from "./HermesRuntimeDriver";
import { HERMES_CONVERSATION_EFFICIENCY_POLICY } from "./HermesSessionContext";

const preparation = hermesRuntimeDriver.preparation.createController({
  request: (options) => hermesRuntimeDriver.runs.request(options),
  bindConversationSessionId: (conversationId, sessionId) =>
    external.bindConversationSessionId(conversationId, sessionId),
  getConversationForSessionBinding: vi.fn(async () => null),
  logFallback: vi.fn(),
  deduplicateHistoryEnabled: () => false,
  systemPolicy: "default policy",
});

describe("Hermes session context characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    external.getInstanceById.mockResolvedValue({ id: "instance-1" });
    external.bindConversationSessionId.mockResolvedValue(true);
  });

  it("binds and returns a native Hermes session created upstream", async () => {
    external.requestTraefikInternal.mockResolvedValue({
      ok: true,
      statusCode: 201,
      json: { session_id: "native-session" }
    });

    await expect(preparation.createSessionBinding("instance-1", "conversation-1", "Title"))
      .resolves.toEqual({ sessionId: "native-session", state: "created" });
    expect(external.bindConversationSessionId).toHaveBeenCalledWith("conversation-1", "native-session");
  });

  it("binds a stable fallback id when session creation is unavailable", async () => {
    external.requestTraefikInternal.mockResolvedValue({ ok: false, statusCode: 404, error: "missing" });

    await expect(preparation.createSessionBinding("instance-1", "conversation-1"))
      .resolves.toEqual({ sessionId: "mybay_conversation1", state: "fallback" });
    expect(external.bindConversationSessionId).toHaveBeenCalledWith("conversation-1", "mybay_conversation1");
  });

  it("throws the stable create failure with the upstream status", async () => {
    external.requestTraefikInternal.mockResolvedValue({ ok: false, statusCode: 500, error: "timeout" });

    await expect(preparation.createSessionBinding("instance-1", "conversation-1"))
      .rejects.toMatchObject({ message: "HERMES_SESSION_CREATE_FAILED", statusCode: 500 });
    expect(external.bindConversationSessionId).not.toHaveBeenCalled();
  });

  it("uses current input only for an existing session when history deduplication is enabled", () => {
    const payload = preparation.buildRunPayload({
      userContent: "question",
      agentAttachmentContext: "attachment context",
      sessionBinding: { sessionId: "native-session", state: "existing" },
      historyMessages: [{ role: "assistant", content: "old answer" }],
      deduplicateHistoryEnabled: true,
      reasoningEffort: "deep",
      systemPolicy: "managed policy"
    });

    expect(payload).toEqual({
      input: "question\n\nattachment context",
      instructions: expect.stringContaining("managed policy"),
      session_id: "native-session",
      model_options: {
        reasoning_effort: "high",
        reasoning: { enabled: true, effort: "high" }
      }
    });
    expect(payload.instructions).toContain(HERMES_CONVERSATION_EFFICIENCY_POLICY);
  });

  it("filters the current message and builds ordered full history for fallback sessions", () => {
    const payload = preparation.buildRunPayload({
      userContent: "current question",
      currentUserMessageId: "message-current",
      currentRequestId: "request-current",
      sessionBinding: { sessionId: "fallback-session", state: "fallback" },
      historyMessages: [
        { id: "message-old", role: "assistant", content: "old answer" },
        { id: "message-current", role: "user", content: "duplicate by id" },
        { request_id: "request-current", role: "user", content: "duplicate by request" }
      ],
      deduplicateHistoryEnabled: true,
      reasoningEffort: "fast",
      systemPolicy: "managed policy"
    });

    expect(payload).toEqual({
      input: [
        { role: "system", content: expect.stringContaining("managed policy") },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "current question" }
      ],
      instructions: expect.stringContaining("managed policy"),
      session_id: "fallback-session",
      model_options: {
        reasoning_effort: "low",
        reasoning: { enabled: true, effort: "low" }
      }
    });
    expect(payload.instructions).toBe((payload.input as Array<{ role: string; content: string }>)[0].content);
    expect(payload.instructions).toContain(HERMES_CONVERSATION_EFFICIENCY_POLICY);
  });
});
