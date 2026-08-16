import { compareHermesVersions, parseHermesVersion } from "../../shared/version";

export const HERMES_NATIVE_FEISHU_MIN_VERSION =
  process.env.HERMES_NATIVE_FEISHU_MIN_VERSION?.trim() || "v2026.3.30";

function parseCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.toLowerCase());
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.toLowerCase());
  } catch {}
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function supportsFeishu(input: any): boolean {
  if (!input) return false;
  const capabilities = parseCapabilities(input.capabilities);
  if (capabilities.includes("feishu") || capabilities.includes("lark")) return true;
  if (input.feishu_capable === 1 || input.feishu_capable === true || input.feishu_capable === "true") return true;
  const version = String(input.version || input.image_tag || input.tag || input);
  if (/[-_.](?:feishu|lark)(?:$|[-_.])/i.test(version)) return true;
  return !!parseHermesVersion(version) && compareHermesVersions(version, HERMES_NATIVE_FEISHU_MIN_VERSION) >= 0;
}

export function getHermesCapabilities(input: any): string[] {
  return supportsFeishu(input) ? ["core", "feishu"] : ["core"];
}
