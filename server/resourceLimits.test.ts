import { describe, it, expect } from "vitest";
import { getEnvDiskLimit } from "./constants/resourceLimits";
import { resolveServerPort } from "./utils/portResolver";

describe("Host Resource Limits & Port Resolver", () => {
  it("should parse default disk limit from environment variable or fallback to 4096", () => {
    delete process.env.DEFAULT_INSTANCE_DISK_MB;
    expect(getEnvDiskLimit()).toBe(4096);

    process.env.DEFAULT_INSTANCE_DISK_MB = "8192";
    expect(getEnvDiskLimit()).toBe(8192);
    delete process.env.DEFAULT_INSTANCE_DISK_MB;
  });

  it("should resolve server port correctly", () => {
    expect(resolveServerPort(undefined)).toBe(3000);
    expect(resolveServerPort("8080")).toBe(8080);
    expect(resolveServerPort("invalid")).toBe(3000);
    expect(resolveServerPort("70000")).toBe(3000);
  });
});
