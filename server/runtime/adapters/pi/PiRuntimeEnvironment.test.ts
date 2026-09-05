import { describe, expect, it, vi } from "vitest";

vi.mock("../../../crypto", () => ({ decrypt: (value: string) => value }));
import { buildPiRuntimeEnvironment, resolvePiProvider } from "./PiRuntimeEnvironment";

describe("Pi runtime environment", () => {
  it("maps control-plane providers to Pi provider ids without losing credentials", () => {
    expect(resolvePiProvider("openai-api")).toBe("openai");
    expect(buildPiRuntimeEnvironment({
      provider: "deepseek", model: "deepseek-chat", providerApiKey: "provider-secret", hermesApiKey: "bridge-secret", internal_web_port: 8080,
    })).toMatchObject({
      PI_PROVIDER: "deepseek", PI_MODEL: "deepseek-chat", DEEPSEEK_API_KEY: "provider-secret", PI_BRIDGE_API_KEY: "bridge-secret", PORT: "8080",
    });
  });

  it("rejects providers outside the experimental compatibility set", () => {
    expect(() => resolvePiProvider("custom-openai-compatible")).toThrow("PI_PROVIDER_UNSUPPORTED");
  });
});
