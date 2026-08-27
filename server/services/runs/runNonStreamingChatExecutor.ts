import { containsDsmlToolCallProtocol, DSML_TOOL_CALL_ERROR_CODE } from "../../utils/dsmlToolCallGuard";
import { normalizeDispatchError } from "./runDispatchRecovery";
import { buildHermesChatMessages, extractAssistantContentFromChatResponse } from "./runHermesProtocol";
import type { RunsRequestOptions, RunsRequestResult } from "./runHermesTransport";

export interface NonStreamingChatMessage {
  id?: string;
  request_id?: string;
  role: string;
  content: string;
}

interface NonStreamingRunTarget {
  id: string;
  instance_id: string;
  reasoning_effort?: unknown;
}

interface RunNonStreamingChatExecutorDependencies {
  requestRuns(options: RunsRequestOptions): Promise<RunsRequestResult>;
  emitStatus(runId: string, status: Record<string, unknown>): void;
  toReasoningModelOptions(value: unknown): unknown;
  completeRun(
    runId: string,
    status: "completed" | "failed",
    assistantContent: string,
    errorCode?: string,
    usage?: unknown,
    durationMs?: number,
    completionEvidence?: { requestId: string; responseStatusCode: number },
  ): Promise<unknown>;
  logOperation(
    operation: string,
    runId: string,
    instanceId: string,
    statusCode: number,
    errorCode?: string,
    durationMs?: number
  ): void;
  now(): number;
}

export function filterCurrentRunMessageFromHistory(
  history: NonStreamingChatMessage[],
  currentUserMessageId?: string | null,
  currentRequestId?: string | null
): NonStreamingChatMessage[] {
  return history.filter((message) => {
    if (currentUserMessageId && message.id === currentUserMessageId) return false;
    if (currentRequestId && message.request_id === currentRequestId) return false;
    return true;
  });
}

export function createRunNonStreamingChatExecutor(
  dependencies: RunNonStreamingChatExecutorDependencies
) {
  return async function executeNonStreamingChat(
    run: NonStreamingRunTarget,
    hermesMessages: NonStreamingChatMessage[],
    hermesSessionId: string,
    reason: string,
    currentUserMessageId?: string | null,
    currentRequestId?: string | null
  ): Promise<boolean> {
    const filteredMessages = filterCurrentRunMessageFromHistory(
      hermesMessages,
      currentUserMessageId,
      currentRequestId
    );

    dependencies.emitStatus(run.id, {
      status: "running",
      mode: "non_streaming_chat",
      reason
    });

    const startTime = dependencies.now();
    const chatResult = await dependencies.requestRuns({
      instanceId: run.instance_id,
      method: "POST",
      path: "/v1/chat/completions",
      body: {
        messages: buildHermesChatMessages(filteredMessages),
        model: "hermes-agent",
        stream: false,
        model_options: dependencies.toReasoningModelOptions(run.reasoning_effort)
      },
      hermesSessionId,
      timeoutMs: 120000
    });
    const durationMs = dependencies.now() - startTime;

    if (!chatResult.ok || !chatResult.json) {
      const errorCode = normalizeDispatchError(chatResult.statusCode, chatResult.error);
      dependencies.logOperation(
        "NON_STREAMING_CHAT_FAILED",
        run.id,
        run.instance_id,
        chatResult.statusCode,
        errorCode,
        durationMs
      );
      await dependencies.completeRun(run.id, "failed", "", errorCode, undefined, durationMs);
      return false;
    }

    const assistantContent = extractAssistantContentFromChatResponse(chatResult.json);
    if (!assistantContent) {
      dependencies.logOperation(
        "NON_STREAMING_CHAT_EMPTY",
        run.id,
        run.instance_id,
        chatResult.statusCode,
        "INVALID_UPSTREAM_RESPONSE",
        durationMs
      );
      await dependencies.completeRun(
        run.id,
        "failed",
        "",
        "UPSTREAM_FAILED",
        chatResult.json?.usage,
        durationMs
      );
      return false;
    }

    if (containsDsmlToolCallProtocol(assistantContent)) {
      dependencies.logOperation(
        "NON_STREAMING_CHAT_DSML_LEAK_BLOCKED",
        run.id,
        run.instance_id,
        chatResult.statusCode,
        DSML_TOOL_CALL_ERROR_CODE,
        durationMs
      );
      await dependencies.completeRun(
        run.id,
        "failed",
        "",
        DSML_TOOL_CALL_ERROR_CODE,
        chatResult.json?.usage,
        durationMs
      );
      return false;
    }

    dependencies.logOperation(
      "RUN_COMPLETED_NON_STREAMING",
      run.id,
      run.instance_id,
      chatResult.statusCode,
      undefined,
      durationMs
    );
    await dependencies.completeRun(
      run.id,
      "completed",
      assistantContent,
      undefined,
      chatResult.json?.usage || {},
      durationMs,
      {
        requestId: String(currentRequestId || ""),
        responseStatusCode: chatResult.statusCode,
      },
    );
    return true;
  };
}
