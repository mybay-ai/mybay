import { describe, expect, it } from "vitest";
import { channelRegistry, getChannelCapabilities } from "./channelRegistry";

const visibleLocalChannels = ["web", "telegram", "feishu", "weixin", "slack", "webhook", "api"];

describe("local channel registry", () => {
  it.each(visibleLocalChannels)("declares %s as supported", (channel) => {
    expect(getChannelCapabilities(channel)?.supported).toBe(true);
  });

  it("declares QR onboarding for Feishu, Lark, and personal WeChat", () => {
    expect(channelRegistry.feishu.supportsQr).toBe(true);
    expect(channelRegistry.lark.supportsQr).toBe(true);
    expect(channelRegistry.weixin).toMatchObject({ supportsQr: true, supportsTest: true, runtimeId: "weixin" });
  });
});