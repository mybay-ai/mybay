import {
  buildFallbackHermesSessionId,
  extractHermesSessionId,
  isFallbackHermesSessionId,
  isLegacyGeneratedSessionId,
  shouldFallbackSessionCreate
} from "./runHermesProtocol";
import type { RunsRequestOptions, RunsRequestResult } from "./runHermesTransport";

export type AgentReasoningEffort = "fast" | "balanced" | "deep";

export interface HermesSessionBindingResult {
  sessionId: string;
  state: "existing" | "created" | "fallback";
}

function isTransientSessionCreateFailure(statusCode: number): boolean {
  return statusCode === 0 || [408, 429, 500, 502, 503, 504].includes(statusCode);
}

export interface BuildRunPayloadOptions {
  userContent: string;
  currentUserMessageId?: string | null;
  currentRequestId?: string | null;
  agentAttachmentContext?: string;
  sessionBinding: HermesSessionBindingResult;
  historyMessages: Array<{ id?: string; request_id?: string; role: string; content: string }>;
  deduplicateHistoryEnabled?: boolean;
  reasoningEffort?: AgentReasoningEffort;
  systemPolicy?: string;
}

interface ConversationSessionBindingRecord {
  session_id?: unknown;
  title?: string | null;
}

interface RunSessionTarget {
  instance_id: string;
  conversation_id: string;
}

interface RunHermesSessionContextDependencies {
  requestRuns(options: RunsRequestOptions): Promise<RunsRequestResult>;
  bindConversationSessionId(conversationId: string, sessionId: string): Promise<unknown>;
  getConversationForSessionBinding(conversationId: string): Promise<ConversationSessionBindingRecord | null>;
  logFallback(conversationId: string, instanceId: string, statusCode: number): void;
  toReasoningModelOptions(value: unknown): unknown;
  deduplicateHistoryEnabled(): boolean;
  systemPolicy: string;
}

export interface RunHermesSessionContextController {
  createBinding(
    instanceId: string,
    conversationId: string,
    title?: string | null,
    options?: { bindImmediately?: boolean; allowTransientFallback?: boolean }
  ): Promise<HermesSessionBindingResult>;
  ensureForConversation(run: RunSessionTarget): Promise<HermesSessionBindingResult>;
  buildPayload(options: BuildRunPayloadOptions): Record<string, unknown>;
}

export function createRunHermesSessionContextController(
  dependencies: RunHermesSessionContextDependencies
): RunHermesSessionContextController {
  async function createBinding(
    instanceId: string,
    conversationId: string,
    title?: string | null,
    options: { bindImmediately?: boolean; allowTransientFallback?: boolean } = {}
  ): Promise<HermesSessionBindingResult> {
    const createResult = await dependencies.requestRuns({
      instanceId,
      method: "POST",
      path: "/api/sessions",
      body: { title: title || "MyBay Agent Conversation" },
      timeoutMs: 10000
    });

    if (createResult.ok && createResult.json) {
      const sessionId = extractHermesSessionId(createResult.json);
      if (sessionId) {
        await dependencies.bindConversationSessionId(conversationId, sessionId);
        return { sessionId, state: "created" };
      }
    }

    const missingSessionIdFromSuccessfulCreate = createResult.ok
      && !extractHermesSessionId(createResult.json);
    if (
      missingSessionIdFromSuccessfulCreate
      || shouldFallbackSessionCreate(createResult.statusCode, createResult.error)
      || (options.allowTransientFallback === true && isTransientSessionCreateFailure(createResult.statusCode))
    ) {
      const fallbackSessionId = buildFallbackHermesSessionId(conversationId);
      dependencies.logFallback(conversationId, instanceId, createResult.statusCode);
      await dependencies.bindConversationSessionId(conversationId, fallbackSessionId);
      return { sessionId: fallbackSessionId, state: "fallback" };
    }

    const error = new Error("HERMES_SESSION_CREATE_FAILED");
    (error as Error & { statusCode?: number }).statusCode = createResult.statusCode;
    throw error;
  }

  async function ensureForConversation(run: RunSessionTarget): Promise<HermesSessionBindingResult> {
    const conversation = await dependencies.getConversationForSessionBinding(run.conversation_id);
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");

    const existingSessionId = typeof conversation.session_id === "string"
      ? conversation.session_id.trim()
      : "";
    if (existingSessionId && !isLegacyGeneratedSessionId(existingSessionId, run.conversation_id)) {
      return {
        sessionId: existingSessionId,
        state: isFallbackHermesSessionId(existingSessionId, run.conversation_id) ? "fallback" : "existing"
      };
    }

    return createBinding(run.instance_id, run.conversation_id, conversation.title, {
      allowTransientFallback: true,
    });
  }

  function buildPayload(options: BuildRunPayloadOptions): Record<string, unknown> {
    const {
      userContent,
      currentUserMessageId,
      currentRequestId,
      agentAttachmentContext,
      sessionBinding,
      historyMessages,
      deduplicateHistoryEnabled = dependencies.deduplicateHistoryEnabled(),
      reasoningEffort = "balanced",
      systemPolicy = dependencies.systemPolicy
    } = options;

    const userPromptWithAttachment = agentAttachmentContext
      ? `${userContent}\n\n${agentAttachmentContext}`
      : userContent;
    const filteredHistory = historyMessages.filter((message) => {
      if (currentUserMessageId && message.id === currentUserMessageId) return false;
      if (currentRequestId && message.request_id === currentRequestId) return false;
      return true;
    });

    if (deduplicateHistoryEnabled && sessionBinding.state === "existing") {
      return {
        input: userPromptWithAttachment,
        instructions: systemPolicy,
        session_id: sessionBinding.sessionId,
        model_options: dependencies.toReasoningModelOptions(reasoningEffort)
      };
    }

    const hermesMessages = filteredHistory.map((message) => ({
      role: message.role,
      content: message.content
    }));
    hermesMessages.unshift({ role: "system", content: systemPolicy });
    hermesMessages.push({ role: "user", content: userPromptWithAttachment });

    return {
      input: hermesMessages,
      session_id: sessionBinding.sessionId,
      model_options: dependencies.toReasoningModelOptions(reasoningEffort)
    };
  }

  return { createBinding, ensureForConversation, buildPayload };
}
