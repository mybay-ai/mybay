import {
  requestHermesRunsAPI,
  streamHermesRunEventsAPI,
} from "./HermesTransport";
import type {
  RuntimeCapabilityDescriptor,
  RuntimeDriver,
  RuntimeRequestOptions,
} from "../../contracts";
import { hermesRunPreparationProvider } from "./HermesRunPreparation";
import { hermesRunEventProvider } from "./HermesRunEvents";
import { hermesRunExecutionProvider } from "./HermesRunExecution";

export const HERMES_RUNTIME_CAPABILITIES: RuntimeCapabilityDescriptor = Object.freeze({
  conversation: { modes: ["streaming", "batch"] },
  cancellation: { supported: true, granularity: "run" },
  terminal: { observation: "status" },
  interactions: { approvals: true, questions: false },
} satisfies RuntimeCapabilityDescriptor);

export const hermesRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: "hermes",
  displayName: "Hermes",
  providerKey: "hermes-core",
  contractVersion: 1,
  capabilities: HERMES_RUNTIME_CAPABILITIES,
  preparation: hermesRunPreparationProvider,
  events: hermesRunEventProvider,
  execution: hermesRunExecutionProvider,
  runs: Object.freeze({
    request: (options: RuntimeRequestOptions) => requestHermesRunsAPI(options),
    streamEvents: streamHermesRunEventsAPI,
  }),
});
