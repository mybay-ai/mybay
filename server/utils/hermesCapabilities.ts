import { compareHermesVersions, parseHermesVersion } from "../../shared/version";
import {
  inferAgentVersionCapabilities,
  orderAgentVersionCapabilities,
  parseAgentVersionCapabilities,
} from "../../shared/agentVersionCapabilities";

export const HERMES_NATIVE_FEISHU_MIN_VERSION =
  process.env.HERMES_NATIVE_FEISHU_MIN_VERSION?.trim() || "v2026.3.30";

export function supportsFeishu(input: any): boolean {
  if (!input) return false;
  const capabilities = parseAgentVersionCapabilities(input.capabilities);
  if (capabilities.includes("feishu") || capabilities.includes("lark")) return true;
  if (input.feishu_capable === 1 || input.feishu_capable === true || input.feishu_capable === "true") return true;
  const version = String(input.version || input.image_tag || input.tag || input);
  if (/[-_.](?:feishu|lark)(?:$|[-_.])/i.test(version)) return true;
  return !!parseHermesVersion(version) && compareHermesVersions(version, HERMES_NATIVE_FEISHU_MIN_VERSION) >= 0;
}

export function getHermesCapabilities(input: any): string[] {
  const explicit = parseAgentVersionCapabilities(input?.capabilities);
  const version = String(input?.version || input?.image_tag || input?.tag || input || "");
  return orderAgentVersionCapabilities([
    "core",
    ...(supportsFeishu(input) ? ["feishu"] : []),
    ...inferAgentVersionCapabilities(version),
    ...explicit,
  ]);
}
