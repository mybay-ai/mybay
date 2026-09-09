import fs from "node:fs";
import path from "node:path";
import { decrypt } from "../../../crypto";
import { providerRegistry } from "../../../../shared/providerRegistry";
import { CODEX_API_PROVIDER_IDS } from "../../../../shared/runtimeModelProviderPolicy";

export function validateCodexConnection(config: any) {
  const mode = config?.codexAuthMode || "chatgpt";
  if (!["chatgpt", "api"].includes(mode)) throw Error("CODEX_AUTH_MODE_INVALID");
  if (mode === "chatgpt") {
    if (config?.provider !== "openai" || config?.baseUrl && config.baseUrl !== "https://api.openai.com/v1" || config?.providerCredentialId || config?.providerApiKey || config?.apiKey) throw Error("CODEX_PROVIDER_UNSUPPORTED");
    return { mode, baseUrl: "" };
  }
  if (config.codexAuthJson || !CODEX_API_PROVIDER_IDS.includes(config.provider)) throw Error("CODEX_PROVIDER_UNSUPPORTED");
  const model = String(config.model || "").trim();
  if (!model || !/^[A-Za-z0-9._:/-]{1,200}$/.test(model)) throw Error("CODEX_MODEL_INVALID");
  const baseUrl = String(config.baseUrl || providerRegistry[config.provider]?.defaultBaseUrl || "").trim();
  let url: URL; try { url = new URL(baseUrl); } catch { throw Error("CODEX_BASE_URL_INVALID"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[\r\n]/.test(baseUrl)) throw Error("CODEX_BASE_URL_INVALID");
  if (!config.providerApiKey && !config.apiKey) throw Error("CODEX_API_KEY_MISSING");
  return { mode, baseUrl: baseUrl.replace(/\/$/, "") };
}

export function normalizeCodexAccountAuth(value: unknown): string {
  let auth: any;
  try { auth = typeof value === "string" && value.length <= 64 * 1024 ? JSON.parse(value) : null; } catch { /* reject below */ }
  const tokens = auth?.tokens;
  if (auth?.auth_mode !== "chatgpt" || !tokens || ["access_token", "refresh_token", "id_token"].some(key => typeof tokens[key] !== "string" || !tokens[key].trim())) {
    throw new Error("CODEX_ACCOUNT_AUTH_INVALID");
  }
  return JSON.stringify({ auth_mode: "chatgpt", tokens: {
    access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token: tokens.id_token,
    ...(typeof tokens.account_id === "string" ? { account_id: tokens.account_id } : {}),
  }, ...(typeof auth.last_refresh === "string" ? { last_refresh: auth.last_refresh } : {}) });
}

export function buildCodexRuntimeEnvironment(config: any): Record<string, string> {
  const connection = validateCodexConnection(config);
  const key = config?.hermesApiKey ? decrypt(config.hermesApiKey) : "";
  if (!key || /[\r\n]/.test(key)) throw Error("CODEX_BRIDGE_API_KEY_MISSING");
  const model = String(config?.model || "").trim();
  if (model && !/^[A-Za-z0-9._:/-]{1,200}$/.test(model)) throw Error("CODEX_MODEL_INVALID");
  const apiKey = connection.mode === "api" ? decrypt(config.providerApiKey || config.apiKey).trim() : "";
  if (connection.mode === "api" && (!apiKey || /[\r\n]/.test(apiKey) || apiKey.includes("***"))) throw Error("CODEX_API_KEY_MISSING");
  return { PORT: "8080", CODEX_BRIDGE_API_KEY: key, CODEX_HOME: "/opt/data/codex",
    CODEX_BRIDGE_DATA_DIR: "/opt/data/codex-bridge", CODEX_WORKSPACE_DIR: "/opt/data/workspace",
    CODEX_AUTH_MODE: connection.mode,
    ...(apiKey ? { MYBAY_CODEX_PROVIDER_KEY: apiKey } : {}),
    ...(model ? { CODEX_MODEL: model } : {}) };
}

export function writeCodexRuntimeEnvironment(instanceId: string, config: any) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)) throw Error("CODEX_INSTANCE_ID_INVALID");
  const root = path.resolve(process.cwd(), "data", "instances", instanceId);
  const finalEnvMap = buildCodexRuntimeEnvironment(config);
  const authPath = path.join(root, "codex", "auth.json");
  // Native refreshes may rotate tokens. Never replace a refreshed account on routine redeploy.
  if (config.codexAuthMode !== "api" && !fs.existsSync(authPath)) {
    const auth = normalizeCodexAccountAuth(config.codexAuthJson ? decrypt(config.codexAuthJson) : null);
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, auth + "\n", { mode: 0o600, flag: "wx" });
  }
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  const connection = validateCodexConnection(config);
  const nativeConfig = connection.mode === "api" ? [
    'model_provider = "mybay_api"',
    `model = ${JSON.stringify(finalEnvMap.CODEX_MODEL)}`,
    '[model_providers.mybay_api]',
    'name = "MyBay configured provider"',
    `base_url = ${JSON.stringify(connection.baseUrl)}`,
    'env_key = "MYBAY_CODEX_PROVIDER_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
  ].join("\n") : "# MyBay ChatGPT account mode\n";
  fs.writeFileSync(path.join(root, "codex", "config.toml"), nativeConfig + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(root, ".env"), Object.entries(finalEnvMap).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(root, "runtime.json"), JSON.stringify({ runtime_type: "codex", auth_mode: connection.mode, model: finalEnvMap.CODEX_MODEL || null }) + "\n");
  return { finalEnvMap };
}
