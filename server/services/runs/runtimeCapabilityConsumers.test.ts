import { describe, expect, it } from "vitest";
import {
  HERMES_RUNTIME_CAPABILITIES,
  canRecoverApprovalInteractions,
  resolveConversationDispatchMode,
  resolveRunCancellationCapability,
  resolveTerminalObservationCapability,
  type RuntimeCapabilityDescriptor,
} from "./runtimeCapabilityConsumers";

function capabilities(overrides: Partial<RuntimeCapabilityDescriptor> = {}): RuntimeCapabilityDescriptor {
  return { ...HERMES_RUNTIME_CAPABILITIES, ...overrides };
}

describe("runtime capability consumers", () => {
  it("prefers streaming and uses batch only when requested or required", () => {
    expect(resolveConversationDispatchMode(HERMES_RUNTIME_CAPABILITIES, { preferBatch: false }))
      .toEqual({ supported: true, mode: "streaming" });
    expect(resolveConversationDispatchMode(HERMES_RUNTIME_CAPABILITIES, { preferBatch: true }))
      .toEqual({ supported: true, mode: "batch" });
    expect(resolveConversationDispatchMode(capabilities({ conversation: { modes: ["batch"] } }), { preferBatch: false }))
      .toEqual({ supported: true, mode: "batch" });
  });

  it("fails closed when no conversation mode is declared", () => {
    expect(resolveConversationDispatchMode(capabilities({ conversation: { modes: [] } }), { preferBatch: false }))
      .toEqual({ supported: false, errorCode: "RUNTIME_CONVERSATION_MODE_UNSUPPORTED" });
  });

  it("accepts only whole-run cancellation", () => {
    expect(resolveRunCancellationCapability(HERMES_RUNTIME_CAPABILITIES)).toEqual({ supported: true, granularity: "run" });
    expect(resolveRunCancellationCapability(capabilities({ cancellation: { supported: true, granularity: "turn" } })))
      .toEqual({ supported: false, errorCode: "RUNTIME_RUN_CANCELLATION_UNSUPPORTED" });
  });

  it("requires an explicit terminal observation path", () => {
    expect(resolveTerminalObservationCapability(HERMES_RUNTIME_CAPABILITIES))
      .toEqual({ supported: true, observation: "status" });
    expect(resolveTerminalObservationCapability(capabilities({ terminal: { observation: "unsupported" } })))
      .toEqual({ supported: false, errorCode: "RUNTIME_TERMINAL_OBSERVATION_UNSUPPORTED" });
  });

  it("exposes interaction recovery independently", () => {
    expect(canRecoverApprovalInteractions(HERMES_RUNTIME_CAPABILITIES)).toBe(true);
    expect(canRecoverApprovalInteractions(capabilities({ interactions: { approvals: false, questions: false } }))).toBe(false);
  });
});
