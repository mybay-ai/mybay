import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { conversationSearchLimiterOptions, conversationWriteLimiterOptions } from "./conversationLimiters";

describe("conversation route limiters", () => {
  const req = { ip: "127.0.0.1", user: { id: "local-admin" } };

  it("limits search independently by client and authenticated user", () => {
    expect(conversationSearchLimiterOptions.max).toBe(60);
    expect(conversationSearchLimiterOptions.keyGenerator(req)).toContain("user:local-admin");
    expect(conversationSearchLimiterOptions.message).toMatchObject({ error: "RATE_LIMIT_EXCEEDED" });
  });

  it("uses a stricter limiter for conversation mutations", () => {
    expect(conversationWriteLimiterOptions.max).toBe(30);
    expect(conversationWriteLimiterOptions.keyGenerator(req)).toContain("user:local-admin");
    expect(conversationWriteLimiterOptions.message).toMatchObject({ error: "RATE_LIMIT_EXCEEDED" });
  });

  it("wires the dedicated limiters into search and every conversation mutation route", () => {
    const source = fs.readFileSync(new URL("./conversation.routes.ts", import.meta.url), "utf8");
    expect(source).toMatch(/router\.get\("\/:id\/conversations\/search", authenticateToken, conversationSearchLimiter,/);

    const mutationRoutes: string[] = source.match(/router\.(?:post|put|patch|delete)\([^\n]+/g) ?? [];
    expect(mutationRoutes.length).toBeGreaterThan(0);
    expect(mutationRoutes.every((route) => route.includes("authenticateToken, conversationWriteLimiter,"))).toBe(true);
  });
});
