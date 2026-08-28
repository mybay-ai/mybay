import type { SetupFormData } from "../../types";
import type { QuickDeployDraft } from "./quickDeployTypes";

export function buildQuickDeployAdvancedInitialData(
  draft: QuickDeployDraft,
  path: string,
): Partial<SetupFormData> {
  const common: Partial<SetupFormData> = {
    runtime_type: "hermes",
    name: draft.name.trim(),
    path,
    username: draft.dashboardUsername.trim(),
    password: draft.dashboardPassword,
    image: "nousresearch/hermes-agent",
    imageTag: "latest",
    enableDashboard: true,
    limitsCpu: "1",
    limitsMem: "1024MB",
    prompt: draft.purpose.trim(),
    channel: "web",
    allowMode: "disabled",
    gatewayAllowAllUsers: false,
    modelBillingMode: "byok",
    skills: [...new Set(draft.selectedSkillIds || [])],
  };

  if (draft.modelStrategy.mode === "saved_credential") {
    return {
      ...common,
      providerCredentialId: draft.modelStrategy.credentialId.trim(),
      provider: draft.modelStrategy.provider.trim(),
      model: draft.modelStrategy.model.trim(),
      baseUrl: draft.modelStrategy.baseUrl?.trim(),
      isCustomModel: draft.modelStrategy.isCustomModel,
    };
  }

  return {
    ...common,
    providerApiKey: draft.modelStrategy.apiKey?.trim(),
    provider: draft.modelStrategy.provider.trim(),
    model: draft.modelStrategy.model.trim(),
    baseUrl: draft.modelStrategy.baseUrl?.trim(),
    isCustomModel: draft.modelStrategy.isCustomModel,
  };
}
