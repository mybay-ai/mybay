import { providerRegistry } from "../../../shared/providerRegistry";

export interface BasicStepData {
  name?: string;
  username?: string;
  password?: string;
  enableDashboard?: boolean;
}

export function hasBasicStepError(data: BasicStepData): boolean {
  if (!data.name) return true;
  if (data.enableDashboard === false) return false;
  return !data.username || !data.password || data.password.length < 8;
}

export interface ModelStepData {
  provider?: string;
  model?: string;
  baseUrl?: string;
  providerApiKey?: string;
  providerCredentialId?: string;
}

export function requiresPredeployModelTest(provider?: string): boolean {
  if (!provider) return true;
  return providerRegistry[provider]?.testStrategy !== "no-predeploy-test";
}

export function hasModelStepError(data: ModelStepData, testSucceeded: boolean): boolean {
  const config = data.provider ? providerRegistry[data.provider] : undefined;
  if (!config || !config.enabled || !data.model) return true;
  if (data.provider === "custom-openai-compatible" && !data.baseUrl) return true;
  if (config.authMode === "oauth-device-code" && !data.providerCredentialId) return true;
  if (config.requiresApiKey && !data.providerApiKey && !data.providerCredentialId) return true;
  return requiresPredeployModelTest(data.provider) && !testSucceeded;
}
