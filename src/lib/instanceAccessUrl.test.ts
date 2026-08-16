import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInstanceAccessUrl } from "./instanceAccessUrl";

afterEach(() => vi.unstubAllGlobals());

describe("resolveInstanceAccessUrl", () => {
  it("replaces a localhost placeholder only in LAN mode", () => {
    vi.stubGlobal("window", { location: { hostname: "192.168.1.50" } });
    expect(resolveInstanceAccessUrl("http://agent-demo.localhost:10001", "lan"))
      .toBe("http://192.168.1.50:10001");
  });

  it("preserves loopback URLs in desktop mode", () => {
    vi.stubGlobal("window", { location: { hostname: "192.168.1.50" } });
    expect(resolveInstanceAccessUrl("http://agent-demo.localhost:10001", "local"))
      .toBe("http://agent-demo.localhost:10001");
  });
  it("preserves Traefik public domains", () => {
    vi.stubGlobal("window", { location: { hostname: "console.example.com" } });
    expect(resolveInstanceAccessUrl("https://agent.example.com", "traefik"))
      .toBe("https://agent.example.com");
  });
});
