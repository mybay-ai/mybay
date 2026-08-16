import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import authRouter, { shouldUseSecureAuthCookie } from "./auth";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
    server = undefined;
  }
});

describe("Local Web auth cookie policy", () => {
  it("keeps Desktop and LAN HTTP cookies usable in production", () => {
    expect(shouldUseSecureAuthCookie({ NODE_ENV: "production", DEPLOYMENT_MODE: "desktop" })).toBe(false);
    expect(shouldUseSecureAuthCookie({ NODE_ENV: "production", DEPLOYMENT_MODE: "lan" })).toBe(false);
  });

  it("requires Secure cookies for server/HTTPS mode", () => {
    expect(shouldUseSecureAuthCookie({ DEPLOYMENT_MODE: "server" })).toBe(true);
    expect(shouldUseSecureAuthCookie({ PUBLIC_APP_URL: "https://console.example.com" })).toBe(true);
  });

  it("honors an explicit operator override", () => {
    expect(shouldUseSecureAuthCookie({ COOKIE_SECURE: "true", DEPLOYMENT_MODE: "desktop" })).toBe(true);
    expect(shouldUseSecureAuthCookie({ COOKIE_SECURE: "false", DEPLOYMENT_MODE: "server" })).toBe(false);
  });

  it("expires the browser auth cookie through the logout endpoint", async () => {
    const app = express();
    app.use("/api/auth", authRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: "mybay_auth_token=test-token" }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("mybay_auth_token=");
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });
});
