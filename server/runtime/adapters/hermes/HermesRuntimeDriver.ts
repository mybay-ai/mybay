import {
  requestHermesRunsAPI,
  streamHermesRunEventsAPI,
} from "../../../services/runs/runHermesTransport";
import type {
  RuntimeCapabilityDescriptor,
  RuntimeDriver,
  RuntimeRequestOptions,
} from "../../contracts";

export const HERMES_RUNTIME_CAPABILITIES: RuntimeCapabilityDescriptor = Object.freeze({
  conversation: { modes: ["streaming", "batch"] },
  cancellation: { supported: true, granularity: "run" },
  terminal: { observation: "status" },
  interactions: { approvals: true, questions: false },
} satisfies RuntimeCapabilityDescriptor);

export const hermesRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: "hermes",
  capabilities: HERMES_RUNTIME_CAPABILITIES,
  runs: Object.freeze({
    request: (options: RuntimeRequestOptions) => {
      const { sessionId, ...requestOptions } = options;
      return requestHermesRunsAPI({ ...requestOptions, hermesSessionId: sessionId });
    },
    streamEvents: streamHermesRunEventsAPI,
  }),
});
