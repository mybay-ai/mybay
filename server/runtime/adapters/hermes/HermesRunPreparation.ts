import {
  createRunHermesSessionContextController,
  type AgentReasoningEffort,
} from "./HermesSessionContext";
import type {
  RuntimeRunPreparationController,
  RuntimeRunPreparationDependencies,
  RuntimeRunPreparationProvider,
} from "../../contracts";

type HermesReasoningEffort = "low" | "medium" | "high";

export function toHermesReasoningModelOptions(value: unknown) {
  const normalized: AgentReasoningEffort = value === "fast" || value === "deep" ? value : "balanced";
  const effort: HermesReasoningEffort = normalized === "fast" ? "low" : normalized === "deep" ? "high" : "medium";
  return {
    reasoning: { enabled: true, effort },
    reasoning_effort: effort,
  };
}

export class HermesRunPreparationProvider implements RuntimeRunPreparationProvider {
  public createController(
    dependencies: RuntimeRunPreparationDependencies,
  ): RuntimeRunPreparationController {
    const controller = createRunHermesSessionContextController({
      requestRuns: dependencies.request,
      bindConversationSessionId: dependencies.bindConversationSessionId,
      getConversationForSessionBinding: dependencies.getConversationForSessionBinding,
      logFallback: dependencies.logFallback,
      toReasoningModelOptions: toHermesReasoningModelOptions,
      deduplicateHistoryEnabled: dependencies.deduplicateHistoryEnabled,
      systemPolicy: dependencies.systemPolicy,
    });

    return {
      createSessionBinding: (...args) => controller.createBinding(...args),
      ensureSessionForConversation: (run) => controller.ensureForConversation(run),
      buildRunPayload: (options) => controller.buildPayload({
        ...options,
        reasoningEffort: options.reasoningEffort as AgentReasoningEffort | undefined,
      }),
    };
  }
}

export const hermesRunPreparationProvider = Object.freeze(new HermesRunPreparationProvider());
