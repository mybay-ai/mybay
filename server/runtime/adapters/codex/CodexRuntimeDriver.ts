import type {
  RuntimeDriver,
  RuntimeRunExecutionController,
  RuntimeRunExecutionDependencies,
  RuntimeRunExecutionProvider,
} from "../../contracts";
import { defineRuntimeCapabilities } from "../../contracts";
import { CODEX_RUNTIME_DEFINITION } from "../../../../shared/runtimeCatalog";
import { requestInternalRuntimeAPI, streamInternalRuntimeEventsAPI } from "../../transports/InternalRuntimeTransport";
import { codexRunPreparationProvider } from "./CodexRunPreparation";
import { normalizedRunEventProvider } from "../../events/NormalizedRunEvents";

class CodexExecutionProvider implements RuntimeRunExecutionProvider {
  public createController(
    dependencies: RuntimeRunExecutionDependencies,
  ): RuntimeRunExecutionController {
    return {
      sessionCreateFailureCode: "CODEX_SESSION_CREATE_FAILED",
      sessionRebindFailureCode: "CODEX_SESSION_REBIND_FAILED",
      shouldPreferBatch: () => false,
      isStaleSessionError: (statusCode, error) => statusCode === 404 || String(error || "").includes("SESSION_NOT_FOUND"),
      shouldFallbackDispatch: () => false,
      shouldFallbackStreaming: () => false,
      staleSessionRecoveryEnabled: () => true,
      executeBatch: async (run) => {
        await dependencies.completeRun(run.id, "failed", "", "CODEX_BATCH_MODE_UNSUPPORTED");
        return false;
      },
    };
  }
}

export const CODEX_RUNTIME_CAPABILITIES = defineRuntimeCapabilities(CODEX_RUNTIME_DEFINITION.lifecycle);

export const codexRuntimeDriver: RuntimeDriver = Object.freeze({
  runtimeType: CODEX_RUNTIME_DEFINITION.runtime.type,
  displayName: CODEX_RUNTIME_DEFINITION.displayName,
  providerKey: CODEX_RUNTIME_DEFINITION.providerKey,
  contractVersion: CODEX_RUNTIME_DEFINITION.contractVersion,
  capabilities: CODEX_RUNTIME_CAPABILITIES,
  preparation: codexRunPreparationProvider,
  // The bridge emits the normalized MyBay Runs v1 event vocabulary.
  events: normalizedRunEventProvider,
  execution: Object.freeze(new CodexExecutionProvider()),
  runs: Object.freeze({
    request: requestInternalRuntimeAPI,
    streamEvents: streamInternalRuntimeEventsAPI,
  }),
});
