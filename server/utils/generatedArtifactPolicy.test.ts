import { describe, expect, it } from "vitest";
import {
  GENERATED_ARTIFACT_SYSTEM_POLICY,
  resolveGeneratedArtifactCategory,
} from "./generatedArtifactPolicy";

describe("generated artifact path policy", () => {
  it.each([
    ["index.html", "web"],
    ["app.js", "web"],
    ["deck.pptx", "presentations"],
    ["report.pdf", "documents"],
    ["sales.xlsx", "spreadsheets"],
    ["cover.png", "images"],
    ["config.yaml", "data"],
    ["bundle.zip", "archives"],
    ["binary.bin", "other"],
  ])("maps %s to %s", (fileName, category) => {
    expect(resolveGeneratedArtifactCategory(fileName)).toBe(category);
  });

  it("keeps project resources together and exposes container paths only", () => {
    expect(GENERATED_ARTIFACT_SYSTEM_POLICY).toContain("/opt/data/outputs/<类别>/<项目名>/");
    expect(GENERATED_ARTIFACT_SYSTEM_POLICY).toContain("保存在同一个 web 项目目录");
    expect(GENERATED_ARTIFACT_SYSTEM_POLICY).toContain("只返回 /opt/data/...");
    expect(GENERATED_ARTIFACT_SYSTEM_POLICY).toContain("不得猜测、输出或记录宿主机盘符");
  });
});
