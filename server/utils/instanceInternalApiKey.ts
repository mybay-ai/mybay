import { decrypt } from "../crypto";

export type InternalApiKeyError =
  | "HERMES_INTERNAL_API_KEY_MISSING"
  | "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED";

export interface InternalApiKeyResolution {
  ok: boolean;
  apiKey?: string;
  source?: string;
  error?: InternalApiKeyError;
}

const INTERNAL_API_KEY_FIELDS = [
  "apiServerKey",
  "internalApiServerKey",
  "internalApiKey",
  "chatApiServerKey",
  "API_SERVER_KEY",
  "hermesApiKey",
  "chatApiKey",
] as const;

export function parseInstanceConfigJson(instance: any): Record<string, any> {
  if (!instance || !instance.config_json) return {};
  if (typeof instance.config_json === "object") return instance.config_json;
  if (typeof instance.config_json !== "string") return {};
  try {
    const parsed = JSON.parse(instance.config_json);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveInstanceInternalApiKey(instance: any): InternalApiKeyResolution {
  const config = parseInstanceConfigJson(instance);

  for (const field of INTERNAL_API_KEY_FIELDS) {
    const rawValue = config[field];
    if (typeof rawValue !== "string" || rawValue.trim() === "") continue;

    try {
      const apiKey = decrypt(rawValue);
      if (typeof apiKey === "string" && apiKey.trim() !== "") {
        return { ok: true, apiKey, source: field };
      }
    } catch {
      return {
        ok: false,
        source: field,
        error: "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED",
      };
    }
  }

  return { ok: false, error: "HERMES_INTERNAL_API_KEY_MISSING" };
}

export function hasConfiguredInternalApiKey(instance: any): boolean {
  const config = parseInstanceConfigJson(instance);
  return INTERNAL_API_KEY_FIELDS.some((field) => {
    const rawValue = config[field];
    return typeof rawValue === "string" && rawValue.trim() !== "";
  });
}