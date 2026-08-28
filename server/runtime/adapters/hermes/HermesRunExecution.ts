import {
  isStaleSessionError,
  isStreamingDecoderCompatError,
  shouldFallbackSessionCreate,
  shouldPreferNonStreamingChatForInstance,
} from "./HermesProtocol";
import { createRunNonStreamingChatExecutor } from "./HermesBatchExecutor";
import type {
  RuntimeRunExecutionController,
  RuntimeRunExecutionDependencies,
  RuntimeRunExecutionProvider,
} from "../../contracts";
import { toHermesReasoningModelOptions } from "./HermesRunPreparation";

export class HermesRunExecutionProvider implements RuntimeRunExecutionProvider {
  public createController(
    dependencies: RuntimeRunExecutionDependencies,
  ): RuntimeRunExecutionController {
    const executeBatch = createRunNonStreamingChatExecutor({
      requestRuns: dependencies.request,
      emitStatus: dependencies.emitStatus,
      toReasoningModelOptions: toHermesReasoningModelOptions,
      completeRun: dependencies.completeRun,
      logOperation: dependencies.logOperation,
      now: dependencies.now,
    });

    return {
      sessionCreateFailureCode: "HERMES_SESSION_CREATE_FAILED",
      sessionRebindFailureCode: "HERMES_SESSION_REBIND_FAILED",
      shouldPreferBatch: shouldPreferNonStreamingChatForInstance,
      isStaleSessionError,
      shouldFallbackDispatch: shouldFallbackSessionCreate,
      shouldFallbackStreaming: isStreamingDecoderCompatError,
      staleSessionRecoveryEnabled: () => process.env.MYBAY_RECOVER_STALE_HERMES_SESSION === "true",
      executeBatch,
    };
  }
}

export const hermesRunExecutionProvider = Object.freeze(new HermesRunExecutionProvider());
