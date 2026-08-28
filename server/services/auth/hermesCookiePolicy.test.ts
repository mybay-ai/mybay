import { describe, expect, it } from "vitest";
import {
  hasHermesSessionCookie,
  isValidHermesLoginCookieName,
  parseCookies,
  rewriteHermesCookieHostOnly,
  splitCombinedSetCookie,
} from "./hermesCookiePolicy";

describe("Hermes cookie policy", () => {
  it("parses encoded cookies and rejects flow-control cookies", () => {
    const cookies = parseCookies("hermes_session_at=hello%20world; csrf_state=blocked");
    expect(cookies.hermes_session_at).toBe("hello world");
    expect(hasHermesSessionCookie(cookies)).toBe(true);
    expect(isValidHermesLoginCookieName("csrf_auth_state")).toBe(false);
  });

  it("rewrites a login cookie as host-only", () => {
    const rewritten = rewriteHermesCookieHostOnly(
      "hermes_session_at=token; Domain=.example.com; Path=/auth; HttpOnly; Max-Age=60; Secure",
      true,
    );
    expect(rewritten).toBe("hermes_session_at=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
    expect(rewritten).not.toContain("Domain=");
  });

  it("splits combined Set-Cookie values without splitting attributes", () => {
    expect(splitCombinedSetCookie("a=1; Path=/, b=2; Path=/")).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});
