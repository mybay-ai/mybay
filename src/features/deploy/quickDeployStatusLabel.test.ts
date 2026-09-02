import { describe, expect, it } from "vitest";
import zh from "../../locales/zh-CN/deploy.json";
import en from "../../locales/en/deploy.json";
import { getQuickDeployStatusTranslationKey } from "./quickDeployStatusLabel";

describe("quick deploy status labels", () => {
  it("maps lifecycle states to localized delivery keys", () => {
    expect(getQuickDeployStatusTranslationKey("deploying")).toBe("quickDeploy.delivery.statuses.deploying");
    expect(zh.quickDeploy.delivery.statuses.deploying).toBe("部署中");
    expect(en.quickDeploy.delivery.statuses.deploying).toBe("Deploying");
  });

  it("keeps diagnostic messages as raw fallbacks", () => {
    expect(getQuickDeployStatusTranslationKey("Docker image pull failed")).toBeNull();
  });

  it("uses localized Chinese conversation copy", () => {
    expect(zh.quickDeploy.delivery.chatTitle).toBe("对话就绪状态");
    expect(zh.quickDeploy.delivery.openChat).toBe("开始对话");
  });
});
