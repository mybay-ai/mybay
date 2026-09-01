import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readThemeTokens(filename: string): string[] {
  const source = readFileSync(new URL(filename, import.meta.url), "utf8");
  return Array.from(source.matchAll(/--theme-([a-z0-9-]+)\s*:/g), match => match[1]).sort();
}

function parseVariables(source: string): Map<string, string> {
  return new Map(Array.from(source.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g), match => [match[1], match[2].trim()]));
}

function resolveHex(name: string, ...sources: Map<string, string>[]): string {
  const variables = new Map(sources.flatMap(source => Array.from(source.entries())));
  let value = variables.get(name);
  const visited = new Set<string>();
  while (value?.startsWith("var(")) {
    const reference = value.match(/^var\(--([a-z0-9-]+)\)$/)?.[1];
    if (!reference || visited.has(reference)) break;
    visited.add(reference);
    value = variables.get(reference);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Unable to resolve --${name} to a hex color`);
  return value;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
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

  it("keeps dark muted text readable on the three main dark surfaces", () => {
    const primitives = parseVariables(readFileSync(new URL("./tokens.css", import.meta.url), "utf8"));
    const dark = parseVariables(readFileSync(new URL("./dark.css", import.meta.url), "utf8"));
    const muted = resolveHex("theme-content-muted", dark, primitives);

    for (const surface of ["theme-canvas", "theme-surface", "theme-surface-muted"]) {
      expect(contrastRatio(muted, resolveHex(surface, dark, primitives))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
