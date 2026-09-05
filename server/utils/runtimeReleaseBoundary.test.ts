import { describe, expect, it } from "vitest";
import {
  getRuntimeReleaseBoundary,
  isPiRuntimeRequest,
  PI_RUNTIME_RELEASE_CODE,
  UNSUPPORTED_RUNTIME_RELEASE_CODE,
} from "./runtimeReleaseBoundary";

describe("Pi runtime experimental release boundary", () => {
  it("fails closed for runtime_type=pi unless explicitly enabled", () => {
    const previous = process.env.MYBAY_ENABLE_PI_RUNTIME;
    delete process.env.MYBAY_ENABLE_PI_RUNTIME;
    expect(isPiRuntimeRequest("pi")).toBe(true);
    expect(getRuntimeReleaseBoundary("pi")).toMatchObject({
      status: 400,
      code: PI_RUNTIME_RELEASE_CODE
    });
    expect(getRuntimeReleaseBoundary("pi")?.error).toContain("experimental");
    expect(getRuntimeReleaseBoundary("pi")?.error).not.toMatch(/v?\d+\.\d+/i);
    process.env.MYBAY_ENABLE_PI_RUNTIME = "true";
    expect(getRuntimeReleaseBoundary("pi")).toBeNull();
    if (previous === undefined) delete process.env.MYBAY_ENABLE_PI_RUNTIME;
    else process.env.MYBAY_ENABLE_PI_RUNTIME = previous;
  });

  it("keeps the supported Hermes create path available", () => {
    expect(getRuntimeReleaseBoundary("hermes")).toBeNull();
    expect(getRuntimeReleaseBoundary(undefined)).toBeNull();
  });

  it("rejects unknown runtime types instead of silently deploying Hermes", () => {
    expect(getRuntimeReleaseBoundary("unknown-runtime")).toMatchObject({
      status: 400,
      code: UNSUPPORTED_RUNTIME_RELEASE_CODE,
    });
    expect(getRuntimeReleaseBoundary({ type: "hermes" })).toMatchObject({
      status: 400,
      code: UNSUPPORTED_RUNTIME_RELEASE_CODE,
    });
  });
});
