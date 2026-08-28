export interface RuntimeCapabilityDescriptor {
  readonly conversation: {
    readonly modes: ReadonlyArray<"streaming" | "batch">;
  };
  readonly cancellation: {
    readonly supported: boolean;
    readonly granularity?: "run" | "turn";
  };
  readonly terminal: {
    readonly observation: "status" | "events" | "unsupported";
  };
  readonly interactions: {
    readonly approvals: boolean;
    readonly questions: boolean;
  };
}

/** Build a capability declaration that cannot drift after registration. */
export function defineRuntimeCapabilities(
  descriptor: RuntimeCapabilityDescriptor,
): RuntimeCapabilityDescriptor {
  return Object.freeze({
    conversation: Object.freeze({
      modes: Object.freeze([...descriptor.conversation.modes]),
    }),
    cancellation: Object.freeze({ ...descriptor.cancellation }),
    terminal: Object.freeze({ ...descriptor.terminal }),
    interactions: Object.freeze({ ...descriptor.interactions }),
  });
}
