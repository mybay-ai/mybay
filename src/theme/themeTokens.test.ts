import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readThemeTokens(filename: string): string[] {
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  return Array.from(source.matchAll(/--theme-([a-z0-9-]+)\s*:/g), match => match[1]).sort();
}

describe("theme token contract", () => {
  const lightSource = readFileSync(new URL("./light.css", import.meta.url), "utf8");
  const lightTokens = readThemeTokens("./light.css");
  const darkTokens = readThemeTokens("./dark.css");

  it("keeps light and dark token names in sync", () => {
    expect(darkTokens).toEqual(lightTokens);
  });

  it("provides the core semantic roles", () => {
    expect(lightTokens).toEqual(expect.arrayContaining([
      "canvas",
      "surface",
      "surface-muted",
      "content",
      "content-secondary",
      "content-muted",
      "outline",
      "brand",
      "focus-ring",
      "status-success-bg",
      "status-warning-bg",
      "status-danger-bg",
    ]));
  });

  it("allows public surfaces to opt into the light token scope", () => {
    expect(lightSource).toContain('[data-theme="light"]');
  });
});
