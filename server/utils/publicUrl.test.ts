import { afterEach, describe, expect, it } from "vitest";
import { buildInstancePublicUrl } from "./publicUrl";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("buildInstancePublicUrl", () => {
  it("uses a loopback dynamic port in local mode", () => {
    process.env.PROXY_MODE = "local";
    expect(buildInstancePublicUrl("agent-demo", 10000)).toBe("http://agent-demo.localhost:10000");
  });

  it("allows a configured LAN host", () => {
    process.env.PROXY_MODE = "lan";
    process.env.LOCAL_INSTANCE_ACCESS_HOST = "192.168.1.20";
    expect(buildInstancePublicUrl("agent-demo", 10001)).toBe("http://192.168.1.20:10001");
  });

  it("uses the selected LAN host from deployment configuration", () => {
    process.env.PROXY_MODE = "local";
    expect(buildInstancePublicUrl("agent-demo", 10002, { mode: "lan", host: "192.168.2.15" }))
      .toBe("http://192.168.2.15:10002");
  });
  it("keeps domain routing in Traefik mode", () => {
    process.env.PROXY_MODE = "traefik";
    process.env.BASE_DOMAIN = "agents.example.com";
    process.env.INSTANCE_PUBLIC_PROTOCOL = "https";
    expect(buildInstancePublicUrl("agent-demo", 10000)).toBe("https://agent-demo.agents.example.com");
  });
});
