import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApplicationHealth, getApplicationVersion } from "./appVersion";

describe("application health version authority", () => {
  it("uses package.json as the health version source of truth", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(getApplicationVersion()).toBe(packageJson.version);
    expect(createApplicationHealth()).toEqual({
      status: "healthy",
      version: packageJson.version
    });
  });
});