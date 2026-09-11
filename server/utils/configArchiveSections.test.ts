import { describe, expect, it } from "vitest";
import {
  buildConfigArchiveSections,
  isConfigArchiveOutputPath,
  isConfigArchiveUploadPath,
} from "./configArchiveSections";

describe("config archive sections", () => {
  it("classifies root and Runtime workspace content without widening arbitrary paths", () => {
    expect(isConfigArchiveOutputPath("outputs/report.md")).toBe(true);
    expect(isConfigArchiveOutputPath("workspace/outputs/report.md")).toBe(true);
    expect(isConfigArchiveUploadPath("workspace/uploads/input.pdf")).toBe(true);
    expect(isConfigArchiveOutputPath("private/workspace/outputs/report.md")).toBe(false);
    expect(isConfigArchiveUploadPath("workspace/secrets/input.pdf")).toBe(false);
  });

  it("declares Runtime workspace files in the existing portable sections", () => {
    expect(buildConfigArchiveSections([
      "workspace/uploads/input.pdf",
      "workspace/outputs/report.md",
    ])).toEqual(["manifest", "config", "business-config", "template-inputs", "uploads", "outputs"]);
  });
});
