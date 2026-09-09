import { describe, expect, it } from "vitest";
import { normalizeRuntimeAccessDraft, supportsRuntimeDashboard } from "./runtimeAccessPolicy";

describe("runtime access policy", () => {
  it.each(["pi", "codex"])("removes stale Dashboard credentials from %s deployment drafts", (runtime) => {
    expect(normalizeRuntimeAccessDraft({
      runtime_type: runtime,
      enableDashboard: true,
      username: "admin",
      password: "secret-password",
      name: "Pi Agent",
    })).toEqual({
      runtime_type: runtime,
      enableDashboard: false,
      username: "",
      password: "",
      name: "Pi Agent",
    });
  });

  it("keeps Hermes Dashboard settings", () => {
    const draft = { runtime_type: "hermes", enableDashboard: true, username: "admin", password: "secret-password" };
    expect(normalizeRuntimeAccessDraft(draft)).toBe(draft);
    expect(supportsRuntimeDashboard("hermes")).toBe(true);
    expect(supportsRuntimeDashboard("pi")).toBe(false);
  });
});
