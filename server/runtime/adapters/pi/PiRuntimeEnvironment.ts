import fs from "node:fs";
import path from "node:path";
import { decrypt } from "../../../crypto";
import { buildProviderRuntimeEnv } from "../../../providerEnv";
import { isMaskedSecretPlaceholder } from "../../../utils/sanitizer";
import { buildA2ARuntimeEnv } from "../../../services/a2aRuntimeConfig";
import { resolvePiRuntimeProvider } from "../../../../shared/runtimeModelProviderPolicy";
import { issueQuestionBridgeCredential } from "../../../services/runs/questionBridgeCredentials";

function decryptOptional(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const plain = decrypt(value).trim();
  return isMaskedSecretPlaceholder(plain) ? "" : plain;
}

export function resolvePiProvider(provider: unknown): string {
  const normalized = String(provider || "").trim().toLowerCase();
  const resolved = resolvePiRuntimeProvider(normalized);
  if (!resolved) throw new Error(`PI_PROVIDER_UNSUPPORTED:${normalized || "missing"}`);
  return resolved;
}

export function buildPiRuntimeEnvironment(config: any): Record<string, string> {
  const provider = resolvePiProvider(config?.provider);
  const model = String(config?.model || "").trim();
  if (!model) throw new Error("PI_MODEL_MISSING");
  const apiKey = decryptOptional(config?.providerApiKey) || decryptOptional(config?.apiKey);
  if (!apiKey) throw new Error("PI_PROVIDER_API_KEY_MISSING");
  const bridgeKey = decryptOptional(config?.hermesApiKey);
  if (!bridgeKey) throw new Error("PI_BRIDGE_API_KEY_MISSING");
  const baseUrl = String(config?.baseUrl || "").trim();
  const providerEnv = buildProviderRuntimeEnv({ provider, model, baseUrl, apiKey });
  delete providerEnv.HERMES_MODEL_PROVIDER;
  delete providerEnv.HERMES_MODEL;
  return {
    ...providerEnv,
    ...buildA2ARuntimeEnv(config),
    PORT: String(config?.internal_web_port || 8080),
    PI_BRIDGE_API_KEY: bridgeKey,
    MYBAY_AGENT_HOME: "/opt/data",
    PI_HOME: "/opt/data",
    PI_PROVIDER: provider,
    PI_MODEL: model,
    PI_THINKING_LEVEL: "medium",
    PI_SESSION_DIR: "/opt/data/pi/sessions",
    PI_RUN_DIR: "/opt/data/pi/runs",
    PI_WORKSPACE_DIR: "/opt/data/workspace",
  };
}

export function writePiRuntimeEnvironment(instanceId: string, config: any) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId)) throw new Error("Invalid instance identifier");
  const root = path.resolve(process.cwd(), "data", "instances");
  const instanceDir = path.resolve(root, instanceId);
  if (!instanceDir.startsWith(`${root}${path.sep}`)) throw new Error("Instance path escaped the managed data directory");
  fs.mkdirSync(instanceDir, { recursive: true });
  const finalEnvMap = buildPiRuntimeEnvironment(config);
  const questionToken = issueQuestionBridgeCredential(instanceId);
  const configuredPort = Number(process.env.PORT || 3000);
  const controlPanelPort = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535 ? configuredPort : 3000;
  finalEnvMap.MYBAY_QUESTION_BRIDGE_URL = `http://mybay-local-control-panel:${controlPanelPort}/internal/questions/${instanceId}`;
  finalEnvMap.MYBAY_QUESTION_BRIDGE_TOKEN = questionToken;
  fs.writeFileSync(path.join(instanceDir, ".env"), Object.entries(finalEnvMap).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(instanceDir, "runtime.json"), JSON.stringify({ runtime_type: "pi", provider: finalEnvMap.PI_PROVIDER, model: finalEnvMap.PI_MODEL, internal_port: Number(finalEnvMap.PORT) }, null, 2) + "\n");
  return { finalEnvMap, piRuntimeConfigResult: { provider: finalEnvMap.PI_PROVIDER, model: finalEnvMap.PI_MODEL } };
}
