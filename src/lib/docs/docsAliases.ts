export const legacyDocsAliases: Record<string, string> = {
  platform: "docs_home",
  getting_started: "getting-started",
  provider_choice: "models/byok-credentials",
  credential_usage: "models/byok-credentials",
  api_key_manual: "models/byok-credentials",
  deploy_instance: "instances/deploy-instance",
  files_storage: "workspace/files",
  security_practices: "security/overview",
  error_troubleshooting: "troubleshooting/common",
};

export function resolveDocsId(value: string): string {
  const decoded = decodeURIComponent(value || "").replace(/^\/+|\/+$/g, "");
  return legacyDocsAliases[decoded] || decoded;
}