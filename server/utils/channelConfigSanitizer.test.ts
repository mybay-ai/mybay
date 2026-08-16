import { describe, expect, it } from "vitest";
import { sanitizeChannelConfigForChannel } from "./channelConfigSanitizer";

describe("channel config sanitization", () => {
  it("keeps only personal WeChat fields for the weixin channel", () => {
    const result = sanitizeChannelConfigForChannel({
      channel: "weixin",
      weixinAccountId: "wx-account",
      weixinToken: "secret-token",
      weixinBaseUrl: "https://ilinkai.weixin.qq.com",
      weixinAllowedUsers: "user-1",
      telegramBotToken: "must-be-removed",
      wechatMpAppSecret: "must-be-removed",
      wecomAppSecret: "must-be-removed",
    });

    expect(result).toMatchObject({
      channel: "weixin",
      configuredChannels: ["weixin"],
      configured_channels: ["weixin"],
      weixinAccountId: "wx-account",
      weixinToken: "secret-token",
      weixinBaseUrl: "https://ilinkai.weixin.qq.com",
      weixinAllowedUsers: "user-1",
    });
    expect(result).not.toHaveProperty("telegramBotToken");
    expect(result).not.toHaveProperty("wechatMpAppSecret");
    expect(result).not.toHaveProperty("wecomAppSecret");
  });

  it("keeps Feishu credentials when Lark is selected", () => {
    const result = sanitizeChannelConfigForChannel({
      channel: "lark",
      feishuAppId: "cli_test",
      feishuAppSecret: "secret",
      feishuRegion: "lark",
      weixinToken: "must-be-removed",
    });

    expect(result.feishuAppId).toBe("cli_test");
    expect(result.feishuAppSecret).toBe("secret");
    expect(result.feishuRegion).toBe("lark");
    expect(result).not.toHaveProperty("weixinToken");
  });
});