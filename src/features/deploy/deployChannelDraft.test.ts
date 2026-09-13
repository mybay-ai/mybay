import { describe, expect, it } from "vitest";
import { switchDeployChannel } from "./deployChannelDraft";

describe("deployment channel switching", () => {
  it("removes previous channel credentials without mutating the draft", () => {
    const draft = { channel: "telegram", telegramBotToken: "test-token", feishuAppId: "test-app", feishuAppSecret: "test-secret", provider: "openai" };
    const next = switchDeployChannel(draft, "feishu");
    expect(next.telegramBotToken).toBeUndefined();
    expect(next.feishuAppId).toBe("test-app");
    expect(next.feishuRegion).toBe("feishu");
    expect(next.provider).toBe("openai");
    expect(draft.telegramBotToken).toBe("test-token");
  });
  it.each(["hermes", "pi", "codex"])("clears IM access when %s switches to web", runtime_type => {
    const next = switchDeployChannel({ runtime_type, feishuAppSecret: "test-secret", gatewayAllowAllUsers: true }, "web");
    expect(next.feishuAppSecret).toBeUndefined();
    expect(next.gatewayAllowAllUsers).toBe(false);
    expect(next.allowMode).toBe("disabled");
    expect(next.runtime_type).toBe(runtime_type);
  });
});
