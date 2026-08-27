export interface RuntimeCapabilityDescriptor {
  conversation: {
    modes: Array<"streaming" | "batch">;
  };
  cancellation: {
    supported: boolean;
    granularity?: "run" | "turn";
  };
  terminal: {
    observation: "status" | "events" | "unsupported";
  };
  interactions: {
    approvals: boolean;
    questions: boolean;
  };
}

export const HERMES_RUNTIME_CAPABILITIES: RuntimeCapabilityDescriptor = Object.freeze({
  conversation: { modes: ["streaming", "batch"] },
  cancellation: { supported: true, granularity: "run" },
  terminal: { observation: "status" },
  interactions: { approvals: true, questions: false },
} satisfies RuntimeCapabilityDescriptor);

export type ConversationDispatchDecision =
  | { supported: true; mode: "streaming" | "batch" }
  | { supported: false; errorCode: "RUNTIME_CONVERSATION_MODE_UNSUPPORTED" };

export function resolveConversationDispatchMode(
  capabilities: RuntimeCapabilityDescriptor,
  options: { preferBatch: boolean },
): ConversationDispatchDecision {
  const modes = new Set(capabilities.conversation.modes);
  if (options.preferBatch) {
    return modes.has("batch")
      ? { supported: true, mode: "batch" }
      : { supported: false, errorCode: "RUNTIME_CONVERSATION_MODE_UNSUPPORTED" };
  }
  if (modes.has("streaming")) return { supported: true, mode: "streaming" };
  if (modes.has("batch")) return { supported: true, mode: "batch" };
  return { supported: false, errorCode: "RUNTIME_CONVERSATION_MODE_UNSUPPORTED" };
}

export type RunCancellationDecision =
  | { supported: true; granularity: "run" }
  | { supported: false; errorCode: "RUNTIME_RUN_CANCELLATION_UNSUPPORTED" };

export function resolveRunCancellationCapability(
  capabilities: RuntimeCapabilityDescriptor,
): RunCancellationDecision {
  if (capabilities.cancellation.supported
    && (!capabilities.cancellation.granularity || capabilities.cancellation.granularity === "run")) {
    return { supported: true, granularity: "run" };
  }
  return { supported: false, errorCode: "RUNTIME_RUN_CANCELLATION_UNSUPPORTED" };
}

export type TerminalObservationDecision =
  | { supported: true; observation: "status" | "events" }
  | { supported: false; errorCode: "RUNTIME_TERMINAL_OBSERVATION_UNSUPPORTED" };

export function resolveTerminalObservationCapability(
  capabilities: RuntimeCapabilityDescriptor,
): TerminalObservationDecision {
  return capabilities.terminal.observation === "unsupported"
    ? { supported: false, errorCode: "RUNTIME_TERMINAL_OBSERVATION_UNSUPPORTED" }
    : { supported: true, observation: capabilities.terminal.observation };
}

export function canRecoverApprovalInteractions(capabilities: RuntimeCapabilityDescriptor): boolean {
  return capabilities.interactions.approvals;
}
