import type { SetupFormData } from "../../types";
import { providerRegistry } from "../../../shared/providerRegistry";
import { normalizeRuntimeAccessDraft } from "../../../shared/runtimeAccessPolicy";

export function transitionDeployRuntime(draft: Partial<SetupFormData>, runtimeType: string): Partial<SetupFormData> {
  if ((draft.runtime_type || "hermes") === runtimeType) return draft;
  const next = { ...draft, runtime_type: runtimeType };
  if (runtimeType === "codex" || draft.runtime_type === "codex") {
    const provider = runtimeType === "codex" ? "openai-codex" : "openai";
    Object.assign(next, { provider, model: providerRegistry[provider].defaultModel, baseUrl: providerRegistry[provider].defaultBaseUrl || "", providerApiKey: "", providerCredentialId: "", isCustomModel: false, codexAuthMode: runtimeType === "codex" ? "api" : undefined, codexAuthJson: undefined });
  }
  if (runtimeType === "pi" || runtimeType === "codex") Object.assign(next, { channel: "web", skills: [], enableDashboard: false });
  return normalizeRuntimeAccessDraft(next);
}
