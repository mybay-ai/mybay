import { providerRegistry } from "../../../shared/providerRegistry";
import { skillPolicyRegistry } from "../../../shared/skillPolicyRegistry";
import type { QuickDeployDraft, QuickDeployValidationIssue } from "./quickDeployTypes";
import { supportsQuickDeployRuntimeProvider } from "../../../shared/runtimeModelProviderPolicy";

export function validateQuickDeployDraft(draft: QuickDeployDraft): QuickDeployValidationIssue[] {
  const codexAccount = draft.runtimeType === "codex" && draft.codexAuthMode !== "api";
  const issues: QuickDeployValidationIssue[] = [];
  const runtimeType = String(draft.runtimeType || "");
  const entrypoint = String(draft.entrypoint || "");

  if (draft.schemaVersion !== 1) issues.push({ code: "unsupportedSchemaVersion", field: "schemaVersion", requiresAdvanced: true });
  if (!["hermes", "pi", "codex"].includes(runtimeType)) issues.push({ code: "unsupportedRuntime", field: "runtimeType", requiresAdvanced: true });
  if (entrypoint !== "web") issues.push({ code: "unsupportedEntrypoint", field: "entrypoint", requiresAdvanced: true });
  if (!["web", "telegram", "feishu", "weixin"].includes(String(draft.channel || ""))) {
    issues.push({ code: "unsupportedChannel", field: "channel", requiresAdvanced: true });
  }
  if (!draft.name?.trim()) issues.push({ code: "nameRequired", field: "name" });
  if (runtimeType === "hermes" && !draft.dashboardUsername?.trim()) issues.push({ code: "dashboardUsernameRequired", field: "dashboardUsername" });
  if (runtimeType === "hermes" && (draft.dashboardPassword || "").length < 8) issues.push({ code: "dashboardPasswordTooShort", field: "dashboardPassword" });
  if (runtimeType !== "hermes" && draft.channel !== "web") issues.push({ code: "unsupportedChannel", field: "channel", requiresAdvanced: true });

  const strategy = draft.modelStrategy;
  const provider = strategy?.provider?.trim();
  const model = strategy?.model?.trim();
  const config = provider ? providerRegistry[provider] : undefined;
  if (!provider) issues.push({ code: "providerRequired", field: "modelStrategy.provider" });
  else if (!config?.enabled) issues.push({ code: "providerUnavailable", field: "modelStrategy.provider" });
  else if (!supportsQuickDeployRuntimeProvider(runtimeType, provider)) issues.push({ code: "runtimeProviderUnsupported", field: "modelStrategy.provider" });
  if (!codexAccount && !model) issues.push({ code: "modelRequired", field: "modelStrategy.model" });
  if (provider === "custom-openai-compatible" && !strategy?.baseUrl?.trim()) {
    issues.push({ code: "customBaseUrlRequired", field: "modelStrategy.baseUrl" });
  }
  if (strategy?.mode === "saved_credential" && !strategy.credentialId?.trim()) {
    issues.push({ code: "savedCredentialRequired", field: "modelStrategy.credentialId" });
  }
  if (config?.authMode === "oauth-device-code" && strategy?.mode !== "saved_credential") {
    issues.push({ code: "oauthCredentialRequired", field: "modelStrategy.credentialId" });
  }
  if (codexAccount && !draft.codexAuthJson?.trim()) issues.push({ code: "codexAccountRequired", field: "codexAuthJson" });
  if (!codexAccount && config?.authMode !== "oauth-device-code" && strategy?.mode === "byok" && (config?.requiresApiKey || runtimeType === "codex") && !strategy.apiKey?.trim()) {
    issues.push({ code: "apiKeyRequired", field: "modelStrategy.apiKey" });
  }
  if (runtimeType === "hermes" && draft.channel === "telegram" && !draft.telegramBotToken?.trim()) {
    issues.push({ code: "telegramBotTokenRequired", field: "telegramBotToken" });
  }
  if (runtimeType === "hermes" && draft.channel === "feishu" && (!draft.feishuAppId?.trim() || !draft.feishuAppSecret?.trim())) {
    issues.push({ code: "feishuCredentialsRequired", field: "feishuAppId" });
  }
  if (runtimeType === "hermes" && draft.channel === "weixin" && (!draft.weixinAccountId?.trim() || !draft.weixinToken?.trim())) {
    issues.push({ code: "weixinCredentialsRequired", field: "weixinAccountId" });
  }
  if (!draft.permissionConfirmed) {
    issues.push({ code: "permissionConfirmationRequired", field: "permissionConfirmed" });
  }

  const advancedSkillIds = [...new Set(draft.selectedSkillIds || [])].filter((skillId) => {
    if (runtimeType !== "hermes") return true;
    const policy = skillPolicyRegistry[skillId];
    return !policy
      || policy.runtimeStatus !== "available"
      || !policy.userSelectable
      || policy.requiresConfirmation
      || policy.riskLevel === "high"
      || policy.riskLevel === "critical";
  });
  if (advancedSkillIds.length > 0) {
    issues.push({
      code: "skillRequiresAdvancedConfiguration",
      field: "selectedSkillIds",
      values: { skillIds: advancedSkillIds.join(",") },
      requiresAdvanced: true,
    });
  }

  return issues;
}

export function canSubmitQuickDeploy(draft: QuickDeployDraft) {
  return validateQuickDeployDraft(draft).length === 0;
}
