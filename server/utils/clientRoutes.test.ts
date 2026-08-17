import { describe, expect, it } from "vitest";
import { isKnownClientRoute } from "./clientRoutes";

describe("production client route fallback", () => {
  it.each(["/terms", "/privacy", "/security"])(
    "serves legal route %s through the SPA fallback",
    (route) => expect(isKnownClientRoute(route)).toBe(true),
  );

  it("keeps unknown routes outside the SPA fallback", () => {
    expect(isKnownClientRoute("/definitely-not-a-page")).toBe(false);
  });
});