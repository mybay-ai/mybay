import { describe, expect, it } from "vitest";
import { buildQuickDeployPath, createQuickDeployDraft } from "./quickDeployConfig";

describe("quick deployment defaults", () => {
  it("creates a local Hermes draft with Web as the safe default channel", () => {
    const draft = createQuickDeployDraft({ suffix: "ABC-123", password: "generated-password" });
    expect(draft).toMatchObject({
      schemaVersion: 1,
      runtimeType: "hermes",
      entrypoint: "web",
      name: "mybay-agent-abc123",
      channel: "web",
      feishuRegion: "feishu",
      weixinBaseUrl: "https://ilinkai.weixin.qq.com",
      dashboardUsername: "admin",
      dashboardPassword: "generated-password",
      permissionConfirmed: false,
      selectedSkillIds: [],
      modelStrategy: { mode: "saved_credential", provider: "deepseek" },
    });
  });

  it("can initialize a Pi quick-deployment draft", () => {
    const draft = createQuickDeployDraft({ runtimeType: "pi", suffix: "PI-123" });
    expect(draft.runtimeType).toBe("pi");
    expect(draft.channel).toBe("web");
    expect(draft.name).toBe("mybay-agent-pi123");
  });

  it("creates a stable Docker-safe path without trusting the display name", () => {
    expect(buildQuickDeployPath("  My First Agent!  ", "Run_456")).toBe("my-first-agent-run456");
    expect(buildQuickDeployPath("中文名称", "***")).toBe("agent-local");
  });
});
