import { describe, expect, it, vi } from "vitest";
import { codexRuntimeDriver } from "./CodexRuntimeDriver";
import { resolveRunCancellationCapability } from "../../../services/runs/runtimeCapabilityConsumers";

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

describe("CodexRuntimeDriver experimental boundary", () => {
  it("admits cancellation of the MyBay run mapped to one native turn", () => {
    expect(resolveRunCancellationCapability(codexRuntimeDriver.capabilities)).toEqual({ supported: true, granularity: "run" });
  });
  it("reuses a persisted Codex session and builds a streaming payload", async () => {
    const controller = codexRuntimeDriver.preparation.createController(dependencies({
      getConversationForSessionBinding: vi.fn(async () => ({ session_id: "codex-v2-session-1234", title: "Codex chat" })),
    }));
    await expect(controller.ensureSessionForConversation({ instance_id: "instance-1", conversation_id: "conversation-1" } as any))
      .resolves.toEqual({ sessionId: "codex-v2-session-1234", state: "existing" });
    expect(controller.shouldLoadManagedHistory?.({ sessionId: "codex-v2-session-1234", state: "existing" })).toBe(false);
    expect(controller.shouldLoadManagedHistory?.({ sessionId: "codex-v2-session-1234", state: "created" })).toBe(true);
    expect(controller.buildRunPayload({
      userContent: "hello",
      reasoningEffort: "deep",
      systemPolicy: "system policy",
      sessionBinding: { sessionId: "codex-v2-session-1234", state: "existing" },
      historyMessages: [],
    } as any)).toMatchObject({
      input: "hello",
      session_id: "codex-v2-session-1234",
      instructions: "system policy",
      model_options: { reasoning_effort: "high" },
    });
  });

  it("passes mounted chat attachments to Codex with their container paths", () => {
    const controller = codexRuntimeDriver.preparation.createController(dependencies());
    expect(controller.buildRunPayload({
      userContent: "Summarize the attachment",
      reasoningEffort: "balanced",
      systemPolicy: "system policy",
      agentAttachmentContext: "1. report.txt\n   - path: /opt/data/chat_uploads/chat-1/stored.txt",
      sessionBinding: { sessionId: "codex-v2-session-1234", state: "existing" },
      historyMessages: [],
    } as any)).toMatchObject({
      input: expect.stringContaining("/opt/data/chat_uploads/chat-1/stored.txt"),
      session_id: "codex-v2-session-1234",
    });
  });

  it("terminalizes accidental batch execution without contacting the runtime", async () => {
    const completeRun = vi.fn(async () => true);
    const controller = codexRuntimeDriver.execution.createController({
      request: vi.fn(), emitStatus: vi.fn(), completeRun, logOperation: vi.fn(), now: () => 0,
    } as any);
    await expect(controller.executeBatch(
      { id: "run-1", instance_id: "instance-1" } as any, [], "codex-session", "prompt",
    )).resolves.toBe(false);
    expect(completeRun).toHaveBeenCalledWith("run-1", "failed", "", "CODEX_BATCH_MODE_UNSUPPORTED");
  });

  it.each([null, "legacy-session-1234"])("creates and binds a corrected session for %s", async (legacySession) => {
    const bindConversationSessionId = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ ok: true, statusCode: 201, json: { id: "codex-created-1234" } }));
    const controller = codexRuntimeDriver.preparation.createController(dependencies({
      request,
      bindConversationSessionId,
      getConversationForSessionBinding: vi.fn(async () => ({ session_id: legacySession, title: "New chat" })),
    }));
    await expect(controller.ensureSessionForConversation({ instance_id: "instance-1", conversation_id: "conversation-1" } as any))
      .resolves.toEqual({ sessionId: "codex-created-1234", state: "created" });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ instanceId: "instance-1", path: "/api/sessions" }));
    expect(bindConversationSessionId).toHaveBeenCalledWith("conversation-1", "codex-created-1234");
  });
});
