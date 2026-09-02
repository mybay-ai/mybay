import type {
  RuntimeDriver,
  RuntimeRunEventController,
  RuntimeRunEventDependencies,
  RuntimeRunEventProvider,
  RuntimeRunEventTracker,
  RuntimeRunExecutionController,
  RuntimeRunExecutionDependencies,
  RuntimeRunExecutionProvider,
  RuntimeRunPreparationController,
  RuntimeRunPreparationDependencies,
  RuntimeRunPreparationProvider,
} from "../../contracts";
import { defineRuntimeCapabilities } from "../../contracts";
import { PI_RUNTIME_RELEASE_CODE } from "../../../utils/runtimeReleaseBoundary";
import { PI_RUNTIME_DEFINITION } from "../../../../shared/runtimeCatalog";

function previewOnlyError(): Error {
  return new Error(PI_RUNTIME_RELEASE_CODE);
}

class PiPreviewPreparationProvider implements RuntimeRunPreparationProvider {
  public createController(
    _dependencies: RuntimeRunPreparationDependencies,
  ): RuntimeRunPreparationController {
    return {
      createSessionBinding: async () => { throw previewOnlyError(); },
      ensureSessionForConversation: async () => { throw previewOnlyError(); },
      buildRunPayload: () => { throw previewOnlyError(); },
    };
  }
}

class PiPreviewEventProvider implements RuntimeRunEventProvider {
  public createController(_dependencies: RuntimeRunEventDependencies): RuntimeRunEventController {
    const trackers = new Map<string, RuntimeRunEventTracker>();
    const getOrCreate = (runId: string, initialPartialOutput: unknown = "") => {
      let tracker = trackers.get(runId);
      if (!tracker) {
        tracker = {
          lastPartialOutput: typeof initialPartialOutput === "string" ? initialPartialOutput : "",
          sentSteps: new Map(),
          activeToolIds: new Map(),
        };
        trackers.set(runId, tracker);
      }
      return tracker;
    };
    return {
      get: (runId) => trackers.get(runId),
      getOrCreate,
      clear: (runId) => trackers.delete(runId),
      emitStep: () => {},
      handle: () => {},
      completeTerminalEvent: async () => false,
    };
  }
}

class PiPreviewExecutionProvider implements RuntimeRunExecutionProvider {
  public createController(
    dependencies: RuntimeRunExecutionDependencies,
  ): RuntimeRunExecutionController {
    return {
      sessionCreateFailureCode: PI_RUNTIME_RELEASE_CODE,
      sessionRebindFailureCode: PI_RUNTIME_RELEASE_CODE,
      shouldPreferBatch: () => false,
      isStaleSessionError: () => false,
      shouldFallbackDispatch: () => false,
      shouldFallbackStreaming: () => false,
      staleSessionRecoveryEnabled: () => false,
      executeBatch: async (run) => {
        await dependencies.completeRun(run.id, "failed", "", PI_RUNTIME_RELEASE_CODE);
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
  preparation: Object.freeze(new PiPreviewPreparationProvider()),
  events: Object.freeze(new PiPreviewEventProvider()),
  execution: Object.freeze(new PiPreviewExecutionProvider()),
  runs: Object.freeze({
    request: async () => ({ ok: false, statusCode: 501, error: PI_RUNTIME_RELEASE_CODE }),
    streamEvents: async () => {},
  }),
});
