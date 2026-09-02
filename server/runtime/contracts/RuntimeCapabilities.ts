import type { RuntimeLifecycleCapabilities } from "../../../shared/runtimeCatalog";

export type RuntimeCapabilityDescriptor = RuntimeLifecycleCapabilities;

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
