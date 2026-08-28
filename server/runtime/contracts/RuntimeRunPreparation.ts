import type {
  RuntimeRequestOptions,
  RuntimeRequestResult,
} from "./RuntimeDriver";

export type RuntimeSessionBindingState = "existing" | "created" | "fallback";

export interface RuntimeSessionBinding {
  readonly sessionId: string;
  readonly state: RuntimeSessionBindingState;
}

export interface RuntimeConversationSessionRecord {
  readonly session_id?: unknown;
  readonly title?: string | null;
}

export interface RuntimeSessionTarget {
  readonly instance_id: string;
  readonly conversation_id: string;
}

export interface RuntimeHistoryMessage {
  readonly id?: string;
  readonly request_id?: string;
  readonly role: string;
  readonly content: string;
}

export interface RuntimeRunPayloadOptions {
  readonly userContent: string;
  readonly currentUserMessageId?: string | null;
  readonly currentRequestId?: string | null;
  readonly agentAttachmentContext?: string;
  readonly sessionBinding: RuntimeSessionBinding;
  readonly historyMessages: RuntimeHistoryMessage[];
  readonly deduplicateHistoryEnabled?: boolean;
  readonly reasoningEffort?: unknown;
  readonly systemPolicy?: string;
}

export interface RuntimeRunPreparationDependencies {
  request(options: RuntimeRequestOptions): Promise<RuntimeRequestResult>;
  bindConversationSessionId(conversationId: string, sessionId: string): Promise<unknown>;
  getConversationForSessionBinding(conversationId: string): Promise<RuntimeConversationSessionRecord | null>;
  logFallback(conversationId: string, instanceId: string, statusCode: number): void;
  deduplicateHistoryEnabled(): boolean;
  systemPolicy: string;
}

export interface RuntimeRunPreparationController {
  createSessionBinding(
    instanceId: string,
    conversationId: string,
    title?: string | null,
    options?: { bindImmediately?: boolean; allowTransientFallback?: boolean },
  ): Promise<RuntimeSessionBinding>;
  ensureSessionForConversation(run: RuntimeSessionTarget): Promise<RuntimeSessionBinding>;
  buildRunPayload(options: RuntimeRunPayloadOptions): Record<string, unknown>;
}

/** Runtime-owned preparation for sessions and dispatch payloads. */
export interface RuntimeRunPreparationProvider {
  createController(dependencies: RuntimeRunPreparationDependencies): RuntimeRunPreparationController;
}
