import { describe, expect, it, vi } from "vitest";
import { PI_RUNTIME_RELEASE_CODE } from "../../../utils/runtimeReleaseBoundary";
import { piRuntimeDriver } from "./PiRuntimeDriver";

describe("PiRuntimeDriver preview boundary", () => {
  it("fails preparation closed with the stable preview code", async () => {
    const controller = piRuntimeDriver.preparation.createController({
      request: vi.fn(),
      bindConversationSessionId: vi.fn(),
      getConversationForSessionBinding: vi.fn(),
      logFallback: vi.fn(),
      deduplicateHistoryEnabled: () => false,
      systemPolicy: "policy",
    });

    await expect(controller.ensureSessionForConversation({
      instance_id: "instance-1",
      conversation_id: "conversation-1",
    })).rejects.toThrow(PI_RUNTIME_RELEASE_CODE);
    expect(() => controller.buildRunPayload({
      userContent: "hello",
      sessionBinding: { sessionId: "preview", state: "fallback" },
      historyMessages: [],
    })).toThrow(PI_RUNTIME_RELEASE_CODE);
  });

  it("terminalizes an accidental batch execution instead of contacting an upstream", async () => {
    const completeRun = vi.fn(async () => true);
    const controller = piRuntimeDriver.execution.createController({
      request: vi.fn(),
      emitStatus: vi.fn(),
      completeRun,
      logOperation: vi.fn(),
      now: () => 0,
    });

    await expect(controller.executeBatch(
      { id: "run-1", instance_id: "instance-1" },
      [],
      "preview-session",
      "preview",
    )).resolves.toBe(false);
    expect(completeRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "",
      PI_RUNTIME_RELEASE_CODE,
    );
  });
});
