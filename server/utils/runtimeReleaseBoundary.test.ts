import { describe, expect, it } from "vitest";
import {
  getRuntimeReleaseBoundary,
  isPiRuntimeBetaEnabled,
  isPiRuntimeRequest,
  PI_RUNTIME_RELEASE_CODE,
  UNSUPPORTED_RUNTIME_RELEASE_CODE,
} from "./runtimeReleaseBoundary";

describe("Pi runtime Beta release boundary", () => {
  it("enables Pi when the setting is missing or explicitly true", () => {
    expect(isPiRuntimeBetaEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isPiRuntimeBetaEnabled({ MYBAY_ENABLE_PI_RUNTIME: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isPiRuntimeRequest("pi")).toBe(true);
    expect(getRuntimeReleaseBoundary("pi", {} as NodeJS.ProcessEnv)).toBeNull();
    expect(getRuntimeReleaseBoundary("pi", { MYBAY_ENABLE_PI_RUNTIME: "true" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("keeps an explicit false value disabled for existing installations", () => {
    expect(isPiRuntimeBetaEnabled({ MYBAY_ENABLE_PI_RUNTIME: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(getRuntimeReleaseBoundary("pi", { MYBAY_ENABLE_PI_RUNTIME: "false" } as NodeJS.ProcessEnv)).toMatchObject({
      status: 400,
      code: PI_RUNTIME_RELEASE_CODE
    });
    expect(getRuntimeReleaseBoundary("pi", { MYBAY_ENABLE_PI_RUNTIME: "false" } as NodeJS.ProcessEnv)?.error).toContain("disabled");
  });

  it("keeps the supported Hermes create path available", () => {
    expect(getRuntimeReleaseBoundary("hermes")).toBeNull();
    expect(getRuntimeReleaseBoundary(undefined)).toBeNull();
  });

  it("allows registered Codex deployment without an opt-in flag", () => {
    expect(getRuntimeReleaseBoundary("codex")).toBeNull();
    expect(getRuntimeReleaseBoundary(" CODEX ")).toBeNull();
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
