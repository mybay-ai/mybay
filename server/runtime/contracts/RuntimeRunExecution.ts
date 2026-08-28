import type { RuntimeRequestOptions, RuntimeRequestResult } from "./RuntimeDriver";
import type { RuntimeHistoryMessage } from "./RuntimeRunPreparation";

export interface RuntimeBatchRunTarget {
  id: string;
  instance_id: string;
  reasoning_effort?: unknown;
}

export interface RuntimeRunExecutionDependencies {
  request(options: RuntimeRequestOptions): Promise<RuntimeRequestResult>;
  emitStatus(runId: string, status: Record<string, unknown>): void;
  completeRun(
    runId: string,
    status: "completed" | "failed",
    assistantContent: string,
    errorCode?: string,
    usage?: Record<string, unknown>,
    durationMs?: number,
    completionEvidence?: { requestId: string; responseStatusCode: number },
  ): Promise<unknown>;
  logOperation(
    operation: string,
    runId: string,
    instanceId: string,
    statusCode: number,
    errorCode?: string,
    durationMs?: number,
  ): void;
  now(): number;
}

export interface RuntimeRunExecutionController {
  readonly sessionCreateFailureCode: string;
  readonly sessionRebindFailureCode: string;
  shouldPreferBatch(instance: unknown): boolean;
  isStaleSessionError(statusCode: number, error?: unknown): boolean;
  shouldFallbackDispatch(statusCode: number, error?: unknown): boolean;
  shouldFallbackStreaming(error?: unknown): boolean;
  staleSessionRecoveryEnabled(): boolean;
  executeBatch(
    run: RuntimeBatchRunTarget,
    messages: RuntimeHistoryMessage[],
    sessionId: string,
    reason: string,
    currentUserMessageId?: string | null,
    currentRequestId?: string | null,
  ): Promise<boolean>;
}

/** Runtime-owned execution policies and compatibility fallbacks. */
export interface RuntimeRunExecutionProvider {
  createController(dependencies: RuntimeRunExecutionDependencies): RuntimeRunExecutionController;
}
