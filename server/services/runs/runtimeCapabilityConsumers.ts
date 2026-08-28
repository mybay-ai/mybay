import type { RuntimeCapabilityDescriptor } from "../../runtime/contracts";

export type { RuntimeCapabilityDescriptor } from "../../runtime/contracts";
export { HERMES_RUNTIME_CAPABILITIES } from "../../runtime/adapters/hermes/HermesRuntimeDriver";

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
