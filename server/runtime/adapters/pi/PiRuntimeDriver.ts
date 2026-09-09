import type {
  RuntimeDriver,
  RuntimeRunExecutionController,
  RuntimeRunExecutionDependencies,
  RuntimeRunExecutionProvider,
} from "../../contracts";
import { defineRuntimeCapabilities } from "../../contracts";
import { PI_RUNTIME_DEFINITION } from "../../../../shared/runtimeCatalog";
import { requestInternalRuntimeAPI, streamInternalRuntimeEventsAPI } from "../../transports/InternalRuntimeTransport";
import { piRunPreparationProvider } from "./PiRunPreparation";
import { normalizedRunEventProvider } from "../../events/NormalizedRunEvents";

class PiExecutionProvider implements RuntimeRunExecutionProvider {
  public createController(
    dependencies: RuntimeRunExecutionDependencies,
  ): RuntimeRunExecutionController {
    return {
      sessionCreateFailureCode: "PI_SESSION_CREATE_FAILED",
      sessionRebindFailureCode: "PI_SESSION_REBIND_FAILED",
      shouldPreferBatch: () => false,
      isStaleSessionError: (statusCode, error) => statusCode === 404 || String(error || "").includes("SESSION_NOT_FOUND"),
      shouldFallbackDispatch: () => false,
      shouldFallbackStreaming: () => false,
      staleSessionRecoveryEnabled: () => true,
      executeBatch: async (run) => {
        await dependencies.completeRun(run.id, "failed", "", "PI_BATCH_MODE_UNSUPPORTED");
        return false;
      },
    };
  }
}

export const PI_RUNTIME_CAPABILITIES = defineRuntimeCapabilities(PI_RUNTIME_DEFINITION.lifecycle);

export const piRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: PI_RUNTIME_DEFINITION.runtime.type,
  displayName: PI_RUNTIME_DEFINITION.displayName,
  providerKey: PI_RUNTIME_DEFINITION.providerKey,
  contractVersion: PI_RUNTIME_DEFINITION.contractVersion,
  capabilities: PI_RUNTIME_CAPABILITIES,
  preparation: piRunPreparationProvider,
  // The bridge emits the normalized MyBay Runs v1 event vocabulary.
  events: normalizedRunEventProvider,
  execution: Object.freeze(new PiExecutionProvider()),
  runs: Object.freeze({
    request: requestInternalRuntimeAPI,
    streamEvents: streamInternalRuntimeEventsAPI,
  }),
});
