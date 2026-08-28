export type QuickDeployModelStrategy =
  | {
      mode: "saved_credential";
      credentialId: string;
      provider: string;
      model: string;
      baseUrl?: string;
      isCustomModel?: boolean;
    }
  | {
      mode: "byok";
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      isCustomModel?: boolean;
    };

export interface QuickDeployDraft {
  schemaVersion: 1;
  runtimeType: "hermes";
  entrypoint: "web";
  name: string;
  purpose: string;
  dashboardUsername: string;
  dashboardPassword: string;
  modelStrategy: QuickDeployModelStrategy;
  selectedSkillIds: string[];
  permissionConfirmed: boolean;
}

export type QuickDeployValidationCode =
  | "unsupportedSchemaVersion"
  | "unsupportedRuntime"
  | "unsupportedEntrypoint"
  | "nameRequired"
  | "dashboardUsernameRequired"
  | "dashboardPasswordTooShort"
  | "providerRequired"
  | "providerUnavailable"
  | "modelRequired"
  | "customBaseUrlRequired"
  | "savedCredentialRequired"
  | "apiKeyRequired"
  | "permissionConfirmationRequired"
  | "skillRequiresAdvancedConfiguration";

export interface QuickDeployValidationIssue {
  code: QuickDeployValidationCode;
  field?: string;
  values?: Record<string, string>;
  requiresAdvanced?: boolean;
}

export class QuickDeployValidationError extends Error {
  constructor(public readonly issues: QuickDeployValidationIssue[]) {
    super(issues[0]?.code || "quickDeployValidationFailed");
    this.name = "QuickDeployValidationError";
  }
}
