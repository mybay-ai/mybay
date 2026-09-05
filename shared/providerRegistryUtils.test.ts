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

describe("Hermes model catalog compatibility", () => {
  it("offers Fable 5.1 through Anthropic and OpenRouter", () => {
    expect(providerRegistry.anthropic.models).toContain("claude-fable-5.1");
    expect(providerRegistry.openrouter.models).toContain("anthropic/claude-fable-5.1");
  });

  it("offers the Astra family through OpenRouter", () => {
    expect(providerRegistry.openrouter.models).toEqual(expect.arrayContaining([
      "openai/gpt-6-astra",
      "openai/gpt-6-astra-fast",
      "openai/gpt-6-astra-flex",
      "openai/gpt-6-astra-pro",
      "openai/gpt-6-astra-pro-fast",
      "openai/gpt-6-astra-pro-flex"
    ]));
  });

  it("keeps Codex OAuth models limited to its runtime fallback catalog", () => {
    expect(providerRegistry["openai-codex"].models).not.toContain("gpt-6-astra");
  });
});
