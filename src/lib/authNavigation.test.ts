import { describe, expect, it } from "vitest";
import { isProtectedAppPath, shouldBroadcastUnauthorized } from "./authNavigation";

describe("authentication navigation policy", () => {
  it.each(["/terms", "/privacy", "/security", "/login"])(
    "keeps public route %s outside the protected app",
    (pathname) => expect(isProtectedAppPath(pathname)).toBe(false),
  );

  it.each(["/app", "/app/instances", "/app/deploy"])(
    "recognizes protected route %s",
    (pathname) => expect(isProtectedAppPath(pathname)).toBe(true),
  );

  it.each(["/api/auth/me", "/api/auth/me?refresh=1", "/api/auth/login", "/api/auth/logout"])(
    "does not broadcast expected guest 401 from %s",
    (path) => expect(shouldBroadcastUnauthorized(path, 401)).toBe(false),
  );

  it("broadcasts 401 responses from protected APIs", () => {
    expect(shouldBroadcastUnauthorized("/api/instances", 401)).toBe(true);
    expect(shouldBroadcastUnauthorized("/api/instances", 403)).toBe(false);
  });
});
