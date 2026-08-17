import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebhookSecretValid, legacyOpenWebhookWarning, resolveWebhookAuthMode, warnIfLegacyOpenWebhooksEnabled } from "./webhookAuthPolicy";

const originalOptIn = process.env.MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS;

afterEach(() => {
  if (originalOptIn === undefined) delete process.env.MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS;
  else process.env.MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS = originalOptIn;
});

describe("webhook authentication policy", () => {
  it("requires a secret by default when no secret is configured", () => {
    expect(resolveWebhookAuthMode({ hasSecret: false })).toBe("secret-required");
  });
  it("requires validation whenever a secret is configured", () => {
    expect(resolveWebhookAuthMode({ configuredMode: "legacy-open", hasSecret: true, legacyOptIn: true })).toBe("secret-required");
  });
  it("does not honor legacy-open without the explicit unsafe opt-in", () => {
    expect(resolveWebhookAuthMode({ configuredMode: "legacy-open", hasSecret: false, legacyOptIn: false })).toBe("secret-required");
  });
  it("allows an explicitly configured legacy instance only with the unsafe opt-in", () => {
    expect(resolveWebhookAuthMode({ configuredMode: "legacy-open", hasSecret: false, legacyOptIn: true })).toBe("legacy-open");
  });
  it.each(["desktop", "lan", "server"] as const)("emits a mode-specific %s warning", (mode) => {
    expect(legacyOpenWebhookWarning(mode).toLowerCase()).toContain(mode === "server" ? "public server" : mode);
  });
  it("warns at startup when unsafe compatibility is enabled", () => {
    process.env.MYBAY_ALLOW_LEGACY_OPEN_WEBHOOKS = "true";
    const warn = vi.fn();
    expect(warnIfLegacyOpenWebhooksEnabled({ warn })).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
  it("accepts only an exact valid secret", () => {
    expect(isWebhookSecretValid("correct-secret", "correct-secret")).toBe(true);
    expect(isWebhookSecretValid("invalid-secret", "correct-secret")).toBe(false);
    expect(isWebhookSecretValid(undefined, "correct-secret")).toBe(false);
  });
});
