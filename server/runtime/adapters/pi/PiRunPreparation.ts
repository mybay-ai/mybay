import type {
  RuntimeRunPreparationController,
  RuntimeRunPreparationDependencies,
  RuntimeRunPreparationProvider,
} from "../../contracts";

function extractSessionId(payload: unknown): string | null {
  const value = (payload as any)?.session_id || (payload as any)?.id || (payload as any)?.data?.id;
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{8,160}$/.test(value) ? value : null;
}

export class PiRunPreparationProvider implements RuntimeRunPreparationProvider {
  public createController(dependencies: RuntimeRunPreparationDependencies): RuntimeRunPreparationController {
    const createSessionBinding: RuntimeRunPreparationController["createSessionBinding"] = async (
      instanceId,
      conversationId,
      title,
      options,
    ) => {
      const response = await dependencies.request({
        instanceId,
        method: "POST",
        path: "/api/sessions",
        body: { title: title || "MyBay Pi Conversation" },
        timeoutMs: 10000,
      });
      const sessionId = response.ok ? extractSessionId(response.json) : null;
      if (!sessionId) {
        const error = new Error("PI_SESSION_CREATE_FAILED");
        (error as Error & { statusCode?: number }).statusCode = response.statusCode;
        throw error;
      }
      if (options?.bindImmediately !== false) await dependencies.bindConversationSessionId(conversationId, sessionId);
      return { sessionId, state: "created" };
    };

    const ensureSessionForConversation: RuntimeRunPreparationController["ensureSessionForConversation"] = async (run) => {
      const conversation = await dependencies.getConversationForSessionBinding(run.conversation_id);
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      const sessionId = typeof conversation.session_id === "string" ? conversation.session_id.trim() : "";
      if (/^[A-Za-z0-9_.:-]{8,160}$/.test(sessionId)) return { sessionId, state: "existing" };
      return createSessionBinding(run.instance_id, run.conversation_id, conversation.title);
    };

    return {
      createSessionBinding,
      ensureSessionForConversation,
      buildRunPayload: (options) => {
        const current = options.agentAttachmentContext
          ? `${options.userContent}\n\n${options.agentAttachmentContext}`
          : options.userContent;
        const history = options.historyMessages.filter((message) => {
          if (options.currentUserMessageId && message.id === options.currentUserMessageId) return false;
          if (options.currentRequestId && message.request_id === options.currentRequestId) return false;
          return true;
        });
        return {
          input: options.sessionBinding.state === "existing"
            ? current
            : [...history.map((message) => ({ role: message.role, content: message.content })), { role: "user", content: current }],
          instructions: options.systemPolicy || dependencies.systemPolicy,
          session_id: options.sessionBinding.sessionId,
          model_options: { reasoning_effort: options.reasoningEffort === "fast" ? "off" : options.reasoningEffort === "deep" ? "high" : "medium" },
        };
      },
    };
  }
}

export const piRunPreparationProvider = Object.freeze(new PiRunPreparationProvider());
