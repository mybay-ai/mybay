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
