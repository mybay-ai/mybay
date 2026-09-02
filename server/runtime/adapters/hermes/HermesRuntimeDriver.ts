import {
  requestHermesRunsAPI,
  streamHermesRunEventsAPI,
} from "./HermesTransport";
import type {
  RuntimeDriver,
  RuntimeRequestOptions,
} from "../../contracts";
import { defineRuntimeCapabilities } from "../../contracts";
import { hermesRunPreparationProvider } from "./HermesRunPreparation";
import { hermesRunEventProvider } from "./HermesRunEvents";
import { hermesRunExecutionProvider } from "./HermesRunExecution";
import { HERMES_RUNTIME_DEFINITION } from "../../../../shared/runtimeCatalog";

export const HERMES_RUNTIME_CAPABILITIES = defineRuntimeCapabilities(HERMES_RUNTIME_DEFINITION.lifecycle);

export const hermesRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: HERMES_RUNTIME_DEFINITION.runtime.type,
  displayName: HERMES_RUNTIME_DEFINITION.displayName,
  providerKey: HERMES_RUNTIME_DEFINITION.providerKey,
  contractVersion: HERMES_RUNTIME_DEFINITION.contractVersion,
  capabilities: HERMES_RUNTIME_CAPABILITIES,
  preparation: hermesRunPreparationProvider,
  events: hermesRunEventProvider,
  execution: hermesRunExecutionProvider,
  runs: Object.freeze({
    request: (options: RuntimeRequestOptions) => requestHermesRunsAPI(options),
    streamEvents: streamHermesRunEventsAPI,
  }),
});
