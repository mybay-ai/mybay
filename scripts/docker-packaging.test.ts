import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldIncludeReleasePath } from "./create-release.mjs";

describe("production Docker packaging", () => {
  it("excludes co-located tests from the Docker build context", () => {
    const dockerIgnore = fs.readFileSync(path.resolve(process.cwd(), ".dockerignore"), "utf8");
    const patterns = dockerIgnore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const testExclusionIndex = patterns.lastIndexOf("**/*.test.*");
    const runtimeReincludeIndex = Math.max(
      patterns.lastIndexOf("!/runtime/pi-bridge/**"),
      patterns.lastIndexOf("!/runtime/codex-bridge/**"),
    );

    expect(testExclusionIndex).toBeGreaterThan(runtimeReincludeIndex);
  });

  it("keeps tests in the auditable source release", () => {
    expect(shouldIncludeReleasePath("src/example.test.ts")).toBe(true);
    expect(shouldIncludeReleasePath("runtime/pi-bridge/example.test.mjs")).toBe(true);
  });
});
