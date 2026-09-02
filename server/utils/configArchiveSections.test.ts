import { describe, expect, it } from "vitest";
import { buildConfigArchiveSections } from "./configArchiveSections";

describe("buildConfigArchiveSections", () => {
  const base = ["manifest", "config", "business-config", "template-inputs"];

  it("declares only sections that contain restorable files", () => {
    expect(buildConfigArchiveSections([])).toEqual(base);
    expect(buildConfigArchiveSections(["uploads/input.txt"])).toEqual([...base, "uploads"]);
    expect(buildConfigArchiveSections(["outputs/report.html"])).toEqual([...base, "outputs"]);
    expect(buildConfigArchiveSections(["documents/input.pdf", "artifacts/result.json"])).toEqual([
      ...base,
      "uploads",
      "outputs",
    ]);
  });

  it("normalizes Windows-style archive separators", () => {
    expect(buildConfigArchiveSections(["files\\input.txt", "results\\result.txt"])).toEqual([
      ...base,
      "uploads",
      "outputs",
    ]);
  });
});
