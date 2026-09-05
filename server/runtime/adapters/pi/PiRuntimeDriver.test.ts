import { describe, expect, it, vi } from "vitest";
import { piRuntimeDriver } from "./PiRuntimeDriver";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    request: vi.fn(),
    bindConversationSessionId: vi.fn(),
    getConversationForSessionBinding: vi.fn(),
    logFallback: vi.fn(),
    deduplicateHistoryEnabled: () => false,
    systemPolicy: "policy",
    ...overrides,
  } as any;
}

describe("PiRuntimeDriver experimental boundary", () => {
  it("reuses a persisted Pi session and builds a streaming payload", async () => {
    const controller = piRuntimeDriver.preparation.createController(dependencies({
      getConversationForSessionBinding: vi.fn(async () => ({ session_id: "pi-session-1234", title: "Pi chat" })),
    }));
    await expect(controller.ensureSessionForConversation({ instance_id: "instance-1", conversation_id: "conversation-1" } as any))
      .resolves.toEqual({ sessionId: "pi-session-1234", state: "existing" });
    expect(controller.buildRunPayload({
      userContent: "hello",
      reasoningEffort: "deep",
      systemPolicy: "system policy",
      sessionBinding: { sessionId: "pi-session-1234", state: "existing" },
      historyMessages: [],
    } as any)).toMatchObject({
      input: "hello",
      session_id: "pi-session-1234",
      instructions: "system policy",
      model_options: { reasoning_effort: "high" },
    });
  });

  it("passes mounted chat attachments to Pi with their container paths", () => {
    const controller = piRuntimeDriver.preparation.createController(dependencies());
    expect(controller.buildRunPayload({
      userContent: "Summarize the attachment",
      reasoningEffort: "balanced",
      systemPolicy: "system policy",
      agentAttachmentContext: "1. report.txt\n   - path: /opt/data/chat_uploads/chat-1/stored.txt",
      sessionBinding: { sessionId: "pi-session-1234", state: "existing" },
      historyMessages: [],
    } as any)).toMatchObject({
      input: expect.stringContaining("/opt/data/chat_uploads/chat-1/stored.txt"),
      session_id: "pi-session-1234",
    });
  });

  it("terminalizes accidental batch execution without contacting the runtime", async () => {
    const completeRun = vi.fn(async () => true);
    const controller = piRuntimeDriver.execution.createController({
      request: vi.fn(), emitStatus: vi.fn(), completeRun, logOperation: vi.fn(), now: () => 0,
    } as any);
    await expect(controller.executeBatch(
      { id: "run-1", instance_id: "instance-1" } as any, [], "pi-session", "prompt",
    )).resolves.toBe(false);
    expect(completeRun).toHaveBeenCalledWith("run-1", "failed", "", "PI_BATCH_MODE_UNSUPPORTED");
  });

  it("creates and binds a native Pi session when the conversation has none", async () => {
    const bindConversationSessionId = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ ok: true, statusCode: 201, json: { id: "pi-created-1234" } }));
    const controller = piRuntimeDriver.preparation.createController(dependencies({
      request,
      bindConversationSessionId,
      getConversationForSessionBinding: vi.fn(async () => ({ session_id: null, title: "New chat" })),
    }));
    await expect(controller.ensureSessionForConversation({ instance_id: "instance-1", conversation_id: "conversation-1" } as any))
      .resolves.toEqual({ sessionId: "pi-created-1234", state: "created" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "instance-1", path: "/api/sessions" }));
    expect(bindConversationSessionId).toHaveBeenCalledWith("conversation-1", "pi-created-1234");
  });
});
