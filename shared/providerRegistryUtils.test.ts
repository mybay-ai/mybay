import { describe, expect, it } from "vitest";
import { providerRegistry } from "./providerRegistry";
import { getProviderDisplayGroups } from "./providerRegistryUtils";

describe("provider display grouping", () => {
  it("places every enabled provider in exactly one display group", () => {
    const groupedIds = getProviderDisplayGroups().flatMap((group) => group.providers.map((provider) => provider.id));
    const enabledIds = Object.values(providerRegistry).filter((provider) => provider.enabled).map((provider) => provider.id);

    expect(new Set(groupedIds).size).toBe(groupedIds.length);
    expect([...groupedIds].sort()).toEqual([...enabledIds].sort());
  });

  it("orders recommendations by registry rank and keeps categories data-driven", () => {
    const groups = getProviderDisplayGroups();
    expect(groups[0]).toMatchObject({
      id: "recommended",
      providers: [
        { id: "deepseek" },
        { id: "qwen" },
        { id: "openai" },
        { id: "gemini" },
        { id: "anthropic" }
      ]
    });
    expect(groups.find((group) => group.id === "aggregator")?.providers.map((provider) => provider.id)).toEqual([
      "openrouter",
      "together"
    ]);
  });

  it("searches provider labels and model ids and can hide OAuth providers", () => {
    const qwenMatches = getProviderDisplayGroups({ query: "qwen3.8-flash" }).flatMap((group) => group.providers.map((provider) => provider.id));
    const withoutOAuth = getProviderDisplayGroups({ includeOAuth: false }).flatMap((group) => group.providers.map((provider) => provider.id));

    expect(qwenMatches).toContain("qwen");
    expect(withoutOAuth).not.toContain("openai-codex");
    expect(withoutOAuth).not.toContain("xai-oauth");
  });
});
