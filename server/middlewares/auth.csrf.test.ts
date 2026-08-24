import { describe, expect, it } from "vitest";
import { isCookieMutationOriginAllowed } from "./auth";

const trustedOrigin = "https://console.example.com";

describe("cookie-authenticated mutation origin policy", () => {
  it("allows same-origin cookie mutations", () => {
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin: trustedOrigin, trustedOrigin,
    })).toBe(true);
  });

  it("rejects wrong or missing origins for cookie mutations", () => {
    expect(isCookieMutationOriginAllowed({
      method: "PATCH", authSource: "cookie", origin: "https://agent.console.example.com", trustedOrigin,
    })).toBe(false);
    expect(isCookieMutationOriginAllowed({
      method: "DELETE", authSource: "cookie", trustedOrigin,
    })).toBe(false);
  });

  it("does not apply browser CSRF checks to safe methods or bearer credentials", () => {
    expect(isCookieMutationOriginAllowed({
      method: "GET", authSource: "cookie", trustedOrigin,
    })).toBe(true);
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "bearer", origin: "https://evil.example", trustedOrigin,
    })).toBe(true);
  });

  it("uses parsed origins instead of prefix or suffix matching", () => {
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin: "https://console.example.com.evil.test", trustedOrigin,
    })).toBe(false);
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin: "https://console.example.com:444", trustedOrigin,
    })).toBe(false);
  });

  it.each([
    ["http://127.0.0.1:3000", "http://localhost:3000"],
    ["http://localhost:3000", "http://127.0.0.1:3000"],
    ["http://[::1]:3000", "http://localhost:3000"],
  ])("allows equivalent loopback origins on the same protocol and port", (origin, configuredOrigin) => {
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin, trustedOrigin: configuredOrigin,
    })).toBe(true);
  });

  it("does not treat a different loopback port or protocol as same-origin", () => {
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin: "http://127.0.0.1:3001", trustedOrigin: "http://localhost:3000",
    })).toBe(false);
    expect(isCookieMutationOriginAllowed({
      method: "POST", authSource: "cookie", origin: "https://127.0.0.1:3000", trustedOrigin: "http://localhost:3000",
    })).toBe(false);
  });
});
