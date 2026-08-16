export interface ChannelItem {
  id: string;
  name: string;
  desc: string;
}

export interface ChannelRegistryItem {
  supported: boolean;
  id: string;
  runtimeId: string;
  requiresUserApproval: boolean;
  supportsPendingAuthEvents: boolean;
  supportLevel?: "stable" | "beta" | "experimental" | "disabled";
  supportsQr?: boolean;
  supportsTest?: boolean;
}

export const channelRegistry: Record<string, ChannelRegistryItem> = {
  none: { supported: false, id: "none", runtimeId: "none", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "disabled" },
  web: { supported: true, id: "web", runtimeId: "web", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "stable", supportsQr: false, supportsTest: false },
  telegram: { supported: true, id: "telegram", runtimeId: "telegram", requiresUserApproval: true, supportsPendingAuthEvents: true, supportLevel: "stable", supportsTest: true },
  feishu: { supported: true, id: "feishu", runtimeId: "feishu", requiresUserApproval: true, supportsPendingAuthEvents: true, supportLevel: "stable", supportsQr: true, supportsTest: true },
  lark: { supported: true, id: "lark", runtimeId: "feishu", requiresUserApproval: true, supportsPendingAuthEvents: true, supportLevel: "stable", supportsQr: true, supportsTest: true },
  weixin: { supported: true, id: "weixin", runtimeId: "weixin", requiresUserApproval: true, supportsPendingAuthEvents: true, supportLevel: "beta", supportsQr: true, supportsTest: true },
  slack: { supported: true, id: "slack", runtimeId: "slack", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta", supportsTest: true },
  discord: { supported: false, id: "discord", runtimeId: "discord", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "experimental" },
  webhook: { supported: true, id: "webhook", runtimeId: "webhook", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta", supportsTest: true },
  whatsapp: { supported: false, id: "whatsapp", runtimeId: "whatsapp", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "experimental" },
  dingtalk: { supported: true, id: "dingtalk", runtimeId: "dingtalk", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta" },
  qq_bot: { supported: true, id: "qq_bot", runtimeId: "qqbot", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "stable" },
  wechat_mp: { supported: true, id: "wechat_mp", runtimeId: "wechat_mp", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta" },
  wecom: { supported: true, id: "wecom", runtimeId: "wecom", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta" },
  api: { supported: true, id: "api", runtimeId: "api", requiresUserApproval: false, supportsPendingAuthEvents: false, supportLevel: "beta" }
};

export function getChannelCapabilities(channel: string | undefined | null): ChannelRegistryItem | undefined {
  return channelRegistry[String(channel || "").trim().toLowerCase()];
}
