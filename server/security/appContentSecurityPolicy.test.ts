import { describe, expect, it } from "vitest";
import { APP_CONTENT_SECURITY_POLICY } from "./appContentSecurityPolicy";

describe("APP_CONTENT_SECURITY_POLICY", () => {
  it("allows same-origin and local blob media previews", () => {
    expect(APP_CONTENT_SECURITY_POLICY).toContain("media-src 'self' data: blob:");
  });

  it("does not grant remote media origins", () => {
    const mediaDirective = APP_CONTENT_SECURITY_POLICY.split(";").find((entry) => entry.trim().startsWith("media-src"));
    expect(mediaDirective).not.toContain("https:");
    expect(mediaDirective).not.toContain("*");
  });
});
