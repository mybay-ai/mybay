import {
  requestHermesRunsAPI,
  streamHermesRunEventsAPI,
} from "../../../services/runs/runHermesTransport";
import type {
  RuntimeCapabilityDescriptor,
  RuntimeDriver,
  RuntimeRequestOptions,
} from "../../contracts";
import { hermesRunPreparationProvider } from "./HermesRunPreparation";
import { hermesRunEventProvider } from "./HermesRunEvents";

export const HERMES_RUNTIME_CAPABILITIES: RuntimeCapabilityDescriptor = Object.freeze({
  conversation: { modes: ["streaming", "batch"] },
  cancellation: { supported: true, granularity: "run" },
  terminal: { observation: "status" },
  interactions: { approvals: true, questions: false },
} satisfies RuntimeCapabilityDescriptor);

export const hermesRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: "hermes",
  providerKey: "hermes-core",
  contractVersion: 1,
  capabilities: HERMES_RUNTIME_CAPABILITIES,
  preparation: hermesRunPreparationProvider,
  events: hermesRunEventProvider,
  runs: Object.freeze({
    request: (options: RuntimeRequestOptions) => {
      const { sessionId, ...requestOptions } = options;
      return requestHermesRunsAPI({ ...requestOptions, hermesSessionId: sessionId });
    },
    streamEvents: streamHermesRunEventsAPI,
  }),
});
