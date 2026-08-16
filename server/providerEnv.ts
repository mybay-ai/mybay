/**
 * ----------------------------------------------------------------------------
 * BACKEND RUNTIME HELPER ONLY
 * ----------------------------------------------------------------------------
 * 
 * 本文件只负责后端 runtime env / config.yaml / health check helper。
 * 不允许在这里维护任何 Provider / Model / Base URL 的硬编码列表。
 * 
 * 所有模型供应商 (Provider)、模型列表 (Models)、默认 Base URL 以及映射配置，
 * 必须统一来自 `shared/providerRegistry.ts`。
 * 这是为了确保“新建实例”与“配置修改 (热更新)”流程使用完全一致的数据源，避免双写错乱。
 */
import { providerRegistry } from "../shared/providerRegistry";
import { resolveProviderRegistryKey } from "../shared/providerRegistryUtils";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import Docker from "dockerode";

export function buildProviderRuntimeEnv({
  provider,
  model,
  baseUrl,
  apiKey
}: {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}): { [key: string]: string } {
  const env: { [key: string]: string } = {};

  if (!provider) return env;

  const prov = provider.toLowerCase();
  const registryKey = resolveProviderRegistryKey(provider, model, baseUrl);

  // Generic configurations
  env.PROVIDER = provider;
  env.MODEL = model;
  if (apiKey) {
    env.PROVIDER_API_KEY = apiKey;
  }
  if (baseUrl) {
    env.BASE_URL = baseUrl;
  }
  const runtimeProvider = providerRegistry[registryKey]?.runtimeProvider || providerRegistry[registryKey]?.hermesProviderId || provider;
  env.HERMES_MODEL_PROVIDER = runtimeProvider;
  env.HERMES_MODEL = model;
  env.current_provider = runtimeProvider;
  env.current_model = model;
  env.DEFAULT_PROVIDER = runtimeProvider;
  env.DEFAULT_MODEL = model;
  env.SELECTED_PROVIDER = runtimeProvider;
  env.SELECTED_MODEL = model;

  // Registry-driven provider prefix & mappings
  let regKey = registryKey || prov;
  if (prov === "custom") {
    regKey = "custom-openai-compatible";
  }
  const conf = providerRegistry[regKey];
  if (conf) {
    const prefix = conf.envPrefix;
    if (prefix) {
      if (apiKey) env[`${prefix}_API_KEY`] = apiKey;
      if (baseUrl || conf.defaultBaseUrl) env[`${prefix}_BASE_URL`] = baseUrl || conf.defaultBaseUrl;
      env[`${prefix}_MODEL`] = model;
    }

    if (conf.alsoInjectEnvPrefix) {
      const altPrefix = conf.alsoInjectEnvPrefix;
      if (apiKey) env[`${altPrefix}_API_KEY`] = apiKey;
      if (baseUrl || conf.defaultBaseUrl) env[`${altPrefix}_BASE_URL`] = baseUrl || conf.defaultBaseUrl;
      env[`${altPrefix}_MODEL`] = model;
    }

    if (conf.injectOpenAICompatible) {
      if (apiKey) env.OPENAI_API_KEY = apiKey;
      if (baseUrl || conf.defaultBaseUrl) env.OPENAI_BASE_URL = baseUrl || conf.defaultBaseUrl;
      env.OPENAI_MODEL = model;
    }

    // Special fallback compatibility
    if (regKey === "gemini") {
      if (apiKey) env.GOOGLE_API_KEY = apiKey;
    }
  } else {
    // Dynamic fallback for any non-registered provider
    const prefix = prov.toUpperCase();
    if (apiKey) env[`${prefix}_API_KEY`] = apiKey;
    if (baseUrl) env[`${prefix}_BASE_URL`] = baseUrl;
    env[`${prefix}_MODEL`] = model;

    // Inject OpenAI as fallback
    if (apiKey) env.OPENAI_API_KEY = apiKey;
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl;
    env.OPENAI_MODEL = model;
  }

  // Remove any empty keys
  const cleanEnv: { [key: string]: string } = {};
  Object.entries(env).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      cleanEnv[k] = v;
    }
  });

  return cleanEnv;
}

export function validateYamlConfigContent(yamlContent: string): { success: boolean; message?: string } {
  const lines = yamlContent.split(/\r?\n/);
  
  // 1. Check for root-level provider object (0 indentation) but specifically detect nested object structures
  let isRootProviderDict = false;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.startsWith("provider:")) {
      const rest = rawLine.substring(9).trim();
      if (rest === "" || rest.startsWith("{")) {
        if (rest === "") {
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j];
            const trimmedNext = nextLine.trim();
            if (trimmedNext === "" || trimmedNext.startsWith("#")) continue;
            const indentMatch = nextLine.match(/^(\s+)/);
            if (indentMatch && indentMatch[1].length > 0) {
              isRootProviderDict = true;
            }
            break;
          }
        } else {
          isRootProviderDict = true;
        }
      }
    }
  }

  if (isRootProviderDict) {
    return {
      success: false,
      message: "发现 config.yaml 含有潜在冲突 root-level \"provider:\" 字典对象。"
    };
  }

  // 2. Parse YAML structures programmatically for native Hermes model
  let hasModelRoot = false;
  let modelProviderVal: string | null = null;
  let modelDefaultVal: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Detect line indentation
    const indentMatch = line.match(/^(\s*)/);
    const indentLength = indentMatch ? indentMatch[1].length : 0;

    if (indentLength === 0) {
      if (trimmed.startsWith("model:")) {
        hasModelRoot = true;
      } else {
        hasModelRoot = false;
      }
    } else {
      if (hasModelRoot && indentLength > 0) {
        const match = trimmed.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.*)/);
        if (match) {
          const key = match[1];
          const val = match[2].trim().replace(/^["']|["']$/g, '');
          if (key === "provider" && !modelProviderVal) {
            modelProviderVal = val;
          } else if ((key === "default" || key === "model") && !modelDefaultVal) {
            modelDefaultVal = val;
          }
        }
      }
    }
  }

  // Fallback: If not found under model:, try root-level scanning for the keys to avoid false alarms
  if (!modelProviderVal || !modelDefaultVal) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([a-zA-Z0-9_\.\-]+)\s*:\s*(.*)/);
      if (match) {
        const key = match[1];
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if ((key === "provider" || key === "model.provider") && !modelProviderVal) {
          modelProviderVal = val;
        } else if ((key === "default" || key === "model" || key === "model.default") && !modelDefaultVal) {
          modelDefaultVal = val;
        }
      }
    }
  }

  if (modelProviderVal === null || modelProviderVal === '') {
    return {
      success: false,
      message: "配置格式验证错误：原生的 'model.provider' 必须是 string 字符串类型及非空."
    };
  }

  if (modelDefaultVal === null || modelDefaultVal === '') {
    return {
      success: false,
      message: "配置格式验证错误：原生的 'model.default' 必须是 string 字符串类型及非空."
    };
  }

  return { success: true };
}

export interface HermesModelConfigInput {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface HermesModelConfigOutput {
  hermesProvider: string;
  hermesModel: string;
  baseUrl: string;
  apiKeyEnvName: string;
  envVars: { [key: string]: string };
  configYaml: { [key: string]: any };
}

export const VALID_HERMES_PROVIDERS = new Set([
  "openai-api",
  "openai",
  "gemini",
  "anthropic",
  "deepseek",
  "kimi-coding",
  "kimi-coding-cn",
  "minimax",
  "minimax-cn",
  "openrouter",
  "groq",
  "siliconflow",
  "xai",
  "zhipu",
  "moonshot",
  "mistral",
  "together",
  "doubao"
]);

export function resolveHermesProvider(provider: string, baseUrl?: string): string {
  const pLower = (provider || '').trim().toLowerCase();
  const bUrl = (baseUrl || '').trim().toLowerCase();
  
  // Look up in providerRegistry
  const regKey = resolveProviderRegistryKey(provider, undefined, baseUrl);
  const regConfig = providerRegistry[regKey] || providerRegistry[pLower];
  if (regConfig) {
    if (regConfig.hermesProviderId) {
      if (pLower === "openai") {
        return regConfig.hermesProviderId; // openai-api
      }
      return regConfig.hermesProviderId;
    }
  }

  // Fallbacks if not explicitly defined in registry
  if (pLower === "google" || pLower === "gemini") {
    return "gemini";
  }
  if (pLower === "openai") {
    return "openai-api";
  }
  if (pLower === "anthropic") {
    return "anthropic";
  }
  if (pLower === "deepseek") {
    return "deepseek";
  }
  if (pLower === "minimax") {
    return "minimax";
  }
  if (pLower === "minimax-cn") {
    return "minimax-cn";
  }
  if (pLower === "custom" || pLower === "custom-openai-compatible" || pLower === "openai-compatible") {
    return "openai-api";
  }

  return pLower;
}

export function buildHermesModelConfig(input: HermesModelConfigInput): HermesModelConfigOutput {
  const provider = (input.provider || '').trim();
  const model = (input.model || '').trim();
  const baseUrl = (input.baseUrl || '').trim();
  const apiKey = (input.apiKey || '').trim();

  const pLower = provider.toLowerCase();
  const regKey = resolveProviderRegistryKey(provider, model, baseUrl);

  // Easy mapping of known providers to their API key variable names
  const envNameMap: { [key: string]: string } = {
    "openai": "OPENAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "google": "GEMINI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "siliconflow": "SILICONFLOW_API_KEY",
    "groq": "GROQ_API_KEY",
    "cohere": "COHERE_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "moonshot": "KIMI_CN_API_KEY",
    "kimi": "KIMI_API_KEY",
    "custom": "OPENAI_API_KEY",
    "custom-openai-compatible": "OPENAI_API_KEY"
  };

  const apiKeyEnvName = envNameMap[regKey] || envNameMap[pLower] || `${provider.toUpperCase()}_API_KEY`;

  const registryConfig = providerRegistry[regKey] || providerRegistry[pLower];
  const effectiveBaseUrl = baseUrl || registryConfig?.defaultBaseUrl || "";
  const hermesProvider = resolveHermesProvider(provider, effectiveBaseUrl);
  const hermesModel = model;

  const envVars: { [key: string]: string } = {};

  // Requirement 5 environment variables
  envVars.HERMES_MODEL_PROVIDER = hermesProvider;
  envVars.HERMES_MODEL = hermesModel;
  envVars.PROVIDER = provider;
  envVars.MODEL = model;
  if (effectiveBaseUrl) {
    envVars.BASE_URL = effectiveBaseUrl;
    if (hermesProvider === "openai" || hermesProvider === "openai-api") {
      envVars.OPENAI_BASE_URL = effectiveBaseUrl;
    }
  }
  if (apiKey) {
    envVars[apiKeyEnvName] = apiKey;
    if (regKey === "moonshot" || pLower === "moonshot" || pLower === "kimi-coding-cn" || pLower === "kimi-cn" || pLower === "moonshot-cn") {
      envVars.KIMI_CN_API_KEY = apiKey;
      if (effectiveBaseUrl) envVars.KIMI_CN_BASE_URL = effectiveBaseUrl;
    }
    if (regKey === "kimi" || pLower === "kimi" || pLower === "kimi-coding") {
      envVars.KIMI_API_KEY = apiKey;
      if (effectiveBaseUrl) envVars.KIMI_BASE_URL = effectiveBaseUrl;
    }
    if (apiKeyEnvName === "GEMINI_API_KEY") {
      envVars.GOOGLE_API_KEY = apiKey;
    }
    envVars.PROVIDER_API_KEY = apiKey;
    if (hermesProvider === "openai" || hermesProvider === "openai-api") {
      envVars.OPENAI_API_KEY = apiKey;
    }
  }

  envVars.HERMES_API_KEY_ENV_NAME = apiKeyEnvName;

  const configYaml: { [key: string]: any } = {
    current_provider: hermesProvider,
    current_model: hermesModel,
    base_url: effectiveBaseUrl,
    api_key_env_name: apiKeyEnvName,
    provider: {
      name: hermesProvider,
      model: hermesModel,
      base_url: effectiveBaseUrl,
      api_key_env_name: apiKeyEnvName
    },
    control_plane: {
      provider: {
        name: provider,
        label: pLower,
        model: model,
        base_url: effectiveBaseUrl,
        type: pLower
      }
    }
  };

  return {
    hermesProvider,
    hermesModel,
    baseUrl: effectiveBaseUrl,
    apiKeyEnvName,
    envVars,
    configYaml
  };
}

export async function repairExistingOpenAIInstances() {
  const fs = require("fs");
  const path = require("path");
  const yaml = require("js-yaml");
  const Docker = require("dockerode");

  const instancesDir = path.join(process.cwd(), "data", "instances");
  if (!fs.existsSync(instancesDir)) {
    return;
  }

  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });

  try {
    const folders = fs.readdirSync(instancesDir);
    for (const instanceId of folders) {
      const folderPath = path.join(instancesDir, instanceId);
      if (!fs.statSync(folderPath).isDirectory()) {
         continue;
      }

      const configYamlPath = path.join(folderPath, "config.yaml");
      const dotEnvPath = path.join(folderPath, ".env");
      const metadataPath = path.join(folderPath, "mybay.instance.yaml");

      if (!fs.existsSync(configYamlPath) || !fs.existsSync(dotEnvPath)) {
        continue;
      }

      // Check helper metadata if exist
      let providerName = "openai";
      let baseUrl = "";
      if (fs.existsSync(metadataPath)) {
        try {
          const metaContent = yaml.load(fs.readFileSync(metadataPath, "utf8")) as any;
          providerName = metaContent?.mybay?.control_plane?.provider?.name || "openai";
          baseUrl = metaContent?.mybay?.control_plane?.provider?.base_url || "";
        } catch (e) {
          // ignore parsing err for metadata
        }
      }

      if (providerName.toLowerCase() !== "openai") {
        continue;
      }

      const isOfficial = !baseUrl || baseUrl.includes("api.openai.com");
      if (!isOfficial) {
        continue; // Custom OpenAI endpoints should remain unchanged
      }

      // Read .env file to check OPENAI_API_KEY presence
      const envContent = fs.readFileSync(dotEnvPath, "utf8");
      const hasKey = envContent.includes("OPENAI_API_KEY=");
      if (!hasKey) {
        continue;
      }

      // Read config.yaml
      const yamlRaw = fs.readFileSync(configYamlPath, "utf8");
      let yamlObj: any;
      try {
        yamlObj = yaml.load(yamlRaw);
      } catch (err) {
        continue; // skip broken YAML
      }

      // Check if `model.provider` is mistakenly set to "openai"
      if (yamlObj && yamlObj.model && yamlObj.model.provider === "openai") {
        console.log(`[Self-Repair] Found misconfigured OpenAI instance: ${instanceId}. Starting atomic update...`);
        
        // Backup
        const backupYamlPath = path.join(folderPath, "config.yaml.bak");
        fs.writeFileSync(backupYamlPath, yamlRaw);

        try {
          // Update model.provider
          yamlObj.model.provider = "openai-api";
          const updatedYaml = yaml.dump(yamlObj);

          // Atomic write
          const tempYamlPath = path.join(folderPath, "config.yaml.tmp");
          fs.writeFileSync(tempYamlPath, updatedYaml);
          fs.renameSync(tempYamlPath, configYamlPath);

          // Verify YAML parsing
          yaml.load(fs.readFileSync(configYamlPath, "utf8"));

          // Also check and update .env if needed to write HERMES_MODEL_PROVIDER=openai-api
          let envLines = envContent.split(/\r?\n/);
          let envChanged = false;
          envLines = envLines.map((line: string) => {
            if (line.startsWith("HERMES_MODEL_PROVIDER=")) {
              envChanged = true;
              return "HERMES_MODEL_PROVIDER=openai-api";
            }
            return line;
          });

          if (!envContent.includes("OPENAI_BASE_URL=")) {
            envLines.push(`OPENAI_BASE_URL=${baseUrl || "https://api.openai.com/v1"}`);
            envChanged = true;
          }

          if (envChanged) {
            fs.writeFileSync(dotEnvPath, envLines.join("\n"));
          }

          console.log(`[Self-Repair] Successfully fixed configs for OpenAI instance: ${instanceId}.`);

          // Restart the gateway container of this instance if it is currently running
          try {
            const containerName = `mybay-agent-${instanceId}`;
            const container = docker.getContainer(containerName);
            const sysState = await container.inspect().catch(() => null);
            if (sysState && sysState.State && sysState.State.Running) {
              console.log(`[Self-Repair] Restarting running container ${containerName}...`);
              await container.restart().catch((e: any) => {
                console.error(`[Self-Repair] Failed to restart container ${containerName}:`, e);
              });
            }
          } catch (restartErr) {
            console.error(`[Self-Repair] Restart container failed for ${instanceId}:`, restartErr);
          }
        } catch (repairErr) {
          console.error(`[Self-Repair] Repair failed for ${instanceId}, rolling back.`, repairErr);
          if (fs.existsSync(backupYamlPath)) {
            fs.copyFileSync(backupYamlPath, configYamlPath);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Self-Repair] Error scanning instances directory:", err.message);
  }
}
