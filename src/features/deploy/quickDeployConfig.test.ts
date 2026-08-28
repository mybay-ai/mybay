import { describe, expect, it } from "vitest";
import { buildQuickDeployPath, createQuickDeployDraft } from "./quickDeployConfig";

describe("quick deployment defaults", () => {
  it("creates a local-only Hermes and Web draft with safe resource defaults", () => {
    const draft = createQuickDeployDraft({ suffix: "ABC-123", password: "generated-password" });
    expect(draft).toMatchObject({
      schemaVersion: 1,
      runtimeType: "hermes",
      entrypoint: "web",
      name: "mybay-agent-abc123",
      dashboardUsername: "admin",
      dashboardPassword: "generated-password",
      permissionConfirmed: false,
      selectedSkillIds: [],
      modelStrategy: { mode: "saved_credential", provider: "deepseek" },
    });
  });

  it("creates a stable Docker-safe path without trusting the display name", () => {
    expect(buildQuickDeployPath("  My First Agent!  ", "Run_456")).toBe("my-first-agent-run456");
    expect(buildQuickDeployPath("中文名称", "***")).toBe("agent-local");
  });
});
