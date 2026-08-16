import { describe, expect, it } from "vitest";
import { resolveSeoConfig } from "./SEOHead";

const t = (key: string) => ({
  "page_titles.overview": "Agent Deployment Center - MyBay",
  "page_titles.instance_files": "File Management - MyBay",
  "page_titles.chat_workspace": "Chat Workspace - MyBay",
}[key] || key);

describe("resolveSeoConfig", () => {
  it("uses the localized instance files title", () => {
    expect(resolveSeoConfig("/app", "?tab=instance-files", t)?.title)
      .toBe("File Management - MyBay");
  });

  it("uses the localized chat workspace title", () => {
    expect(resolveSeoConfig("/app/chat", "", t)?.title)
      .toBe("Chat Workspace - MyBay");
  });
});
