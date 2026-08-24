export function parseInstanceConfigJson(raw: any): any {
  if (raw === null || raw === undefined || raw === "") {
    return {};
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (error: any) {
      throw new Error(`[parseInstanceConfigJson] Failed to parse config JSON string: ${error.message}`);
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

export interface ProviderCredentialSelection {
  explicitlySelected: boolean;
  selectedCredentialId: string;
  switchingToManual: boolean;
  requiresNewManualApiKey: boolean;
}

export function resolveProviderCredentialSelection(
  data: Record<string, any>,
  currentConfig: Record<string, any>,
): ProviderCredentialSelection {
  const explicitlySelected = Object.prototype.hasOwnProperty.call(data, "providerCredentialId");
  const selectedCredentialId = typeof data.providerCredentialId === "string"
    ? data.providerCredentialId.trim()
    : "";
  const switchingToManual = explicitlySelected && !selectedCredentialId;
  const hasNewManualApiKey = typeof data.providerApiKey === "string" && data.providerApiKey.trim() !== "";

  return {
    explicitlySelected,
    selectedCredentialId,
    switchingToManual,
    requiresNewManualApiKey: Boolean(
      switchingToManual && currentConfig.providerCredentialId && !hasNewManualApiKey,
    ),
  };
}

export function isPrivilegedUser(user: any): boolean {
  return user?.role === "admin" || user?.role === "super_admin";
}

