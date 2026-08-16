import { describe, expect, it } from "vitest";
import { getRuntimeReleaseBoundary, isPiRuntimeRequest, PI_RUNTIME_RELEASE_CODE } from "./runtimeReleaseBoundary";

describe("Pi runtime preview release boundary", () => {
  it("fails closed for runtime_type=pi", () => {
    expect(isPiRuntimeRequest("pi")).toBe(true);
    expect(getRuntimeReleaseBoundary("pi")).toMatchObject({
      status: 400,
      code: PI_RUNTIME_RELEASE_CODE
    });
    expect(getRuntimeReleaseBoundary("pi")?.error).not.toMatch(/v?\d+\.\d+/i);
  });

  it("keeps the supported Hermes create path available", () => {
    expect(getRuntimeReleaseBoundary("hermes")).toBeNull();
    expect(getRuntimeReleaseBoundary(undefined)).toBeNull();
  });
});