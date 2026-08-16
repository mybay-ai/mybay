export const FREE_PLAN_ALLOWED_CHANNELS = ["", "none", "web", "telegram", "feishu", "lark", "weixin", "slack", "webhook", "api"] as const;

const FREE_PLAN_ALLOWED_CHANNEL_SET = new Set<string>(FREE_PLAN_ALLOWED_CHANNELS);

export function normalizeDeployChannel(channel: unknown): string {
  const raw = Array.isArray(channel) ? channel[0] : channel;
  const value = String(raw || "web").trim().toLowerCase();
  return value === "none" ? "web" : value;
}

export function isWebOnlyChannel(channel: unknown): boolean {
  const value = normalizeDeployChannel(channel);
  return value === "" || value === "web";
}

export function isFreePlanAllowedDeployChannel(channel: unknown): boolean {
  return FREE_PLAN_ALLOWED_CHANNEL_SET.has(normalizeDeployChannel(channel));
}

export function isDeployChannelAllowedByEntitlement(channel: unknown, externalChannelsAllowed: boolean): boolean {
  return Boolean(externalChannelsAllowed) || isFreePlanAllowedDeployChannel(channel);
}
