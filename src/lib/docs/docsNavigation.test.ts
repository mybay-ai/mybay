import { describe, expect, it } from "vitest";
import { resolveDocsId } from "./docsAliases";
import { getDocsBreadcrumbs, getDocsNavigation, getDocsPagination } from "./docsNavigation";

describe("open-source docs navigation", () => {
  const ids = [
    "getting-started",
    "installation/local-deployment",
    "installation/docker-images",
    "models/byok-credentials",
    "instances/deploy-instance",
    "workspace/files",
    "security/overview",
    "troubleshooting/common",
  ];

  it("uses mirrored navigation for both locales", () => {
    expect(getDocsNavigation("zh-CN").flatMap(group => group.items.map(item => item.id))).toEqual(ids);
    expect(getDocsNavigation("en").flatMap(group => group.items.map(item => item.id))).toEqual(ids);
  });

  it("resolves approved first- and second-batch aliases", () => {
    expect(resolveDocsId("getting_started")).toBe("getting-started");
    expect(resolveDocsId("credential_usage")).toBe("models/byok-credentials");
    expect(resolveDocsId("deploy_instance")).toBe("instances/deploy-instance");
    expect(resolveDocsId("files_storage")).toBe("workspace/files");
    expect(resolveDocsId("security_practices")).toBe("security/overview");
    expect(resolveDocsId("error_troubleshooting")).toBe("troubleshooting/common");
  });

  it("builds breadcrumbs and pagination from locale metadata", () => {
    expect(getDocsBreadcrumbs("en", "security_practices")).toEqual(["Docs", "Security", "Open-source security practices"]);
    expect(getDocsPagination("en", "models/byok-credentials")).toMatchObject({
      previous: { id: "installation/docker-images" },
      next: { id: "instances/deploy-instance" },
    });
  });
});