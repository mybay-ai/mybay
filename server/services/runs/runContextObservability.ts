import { countChatMessageCharacters } from "../../../shared/chatMessageContract";

interface ContextMessage {
  content?: string | null;
}

interface ContextPayload {
  input?: unknown;
}

export interface RunContextAssemblySummary {
  version: 1;
  sessionState: "existing" | "created" | "fallback" | "unknown";
  historyDeduplicationConfigured: boolean;
  inputMode: "current_only" | "full_history" | "unknown";
  historyMessages: number;
  historyChars: number;
  currentMessageChars: number;
  attachmentContextChars: number;
  payloadMessages: number;
  payloadChars: number;
}

function safeChars(value: unknown): number {
  return typeof value === "string" ? countChatMessageCharacters(value) : 0;
}

function payloadShape(payload: ContextPayload): Pick<RunContextAssemblySummary, "inputMode" | "payloadMessages" | "payloadChars"> {
  if (typeof payload.input === "string") {
    return {
      inputMode: "current_only",
      payloadMessages: 1,
      payloadChars: safeChars(payload.input),
    };
  }
  if (Array.isArray(payload.input)) {
    return {
      inputMode: "full_history",
      payloadMessages: payload.input.length,
      payloadChars: payload.input.reduce((total, item) => {
        if (!item || typeof item !== "object") return total;
        return total + safeChars((item as { content?: unknown }).content);
      }, 0),
    };
  }
  return { inputMode: "unknown", payloadMessages: 0, payloadChars: 0 };
}

/**
 * Produce content-free context telemetry. Only counts and enum-like state are
 * returned; prompts, session identifiers, filenames and attachment text never
 * cross this observability boundary.
 */
export function summarizeRunContextAssembly(options: {
  sessionState?: unknown;
  historyDeduplicationConfigured: boolean;
  historyMessages: ContextMessage[];
  currentMessage: string;
  attachmentContext?: string;
  payload: ContextPayload;
}): RunContextAssemblySummary {
  const sessionState = ["existing", "created", "fallback"].includes(String(options.sessionState))
    ? options.sessionState as RunContextAssemblySummary["sessionState"]
    : "unknown";
  return {
    version: 1,
    sessionState,
    historyDeduplicationConfigured: options.historyDeduplicationConfigured,
    ...payloadShape(options.payload),
    historyMessages: options.historyMessages.length,
    historyChars: options.historyMessages.reduce((total, message) => total + safeChars(message.content), 0),
    currentMessageChars: safeChars(options.currentMessage),
    attachmentContextChars: safeChars(options.attachmentContext),
  };
}
