import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSystemSetting } = vi.hoisted(() => ({ getSystemSetting: vi.fn() }));

vi.mock("../db", () => ({
  dbAdapter: {
    getSystemSetting,
  },
}));

import { getDeploymentModeConfig } from "./deploymentMode";

const ENV_KEYS = [
  "DEPLOYMENT_MODE",
  "DEPLOYMENT_LAN_BIND_IP",
  "CONTROL_PANEL_BIND_IP",
  "PROXY_MODE",
  "MYBAY_INSTANCE_ROOT_DOMAIN",
  "BASE_DOMAIN",
  "CONTROL_PANEL_DOMAIN",
  "LETSENCRYPT_EMAIL",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("deployment mode startup precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      Ethernet: [{ address: "192.168.50.20", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "192.168.50.20/24" }],
    } as ReturnType<typeof os.networkInterfaces>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses desktop from .env instead of a stale server database setting", async () => {
    getSystemSetting.mockImplementation(async (key: string) => key === "deployment_mode" ? "server" : "192.168.50.10");
    process.env.DEPLOYMENT_MODE = "desktop";
    process.env.PROXY_MODE = "local";
    process.env.CONTROL_PANEL_BIND_IP = "127.0.0.1";

    const config = await getDeploymentModeConfig();

    expect(config.mode).toBe("desktop");
    expect(config.bindIp).toBe("127.0.0.1");
    expect(config.accessHost).toBe("");
  });

  it("uses the LAN address from .env instead of a stale database address", async () => {
    getSystemSetting.mockImplementation(async (key: string) => key === "deployment_mode" ? "server" : "192.168.50.10");
    process.env.DEPLOYMENT_MODE = "lan";
    process.env.DEPLOYMENT_LAN_BIND_IP = "192.168.50.20";
    process.env.CONTROL_PANEL_BIND_IP = "192.168.50.20";
    process.env.PROXY_MODE = "local";

    const config = await getDeploymentModeConfig();

    expect(config.mode).toBe("lan");
    expect(config.bindIp).toBe("192.168.50.20");
    expect(config.valid).toBe(true);
  });

  it("restores server validation from explicit server environment values", async () => {
    getSystemSetting.mockImplementation(async (key: string) => key === "deployment_mode" ? "lan" : "192.168.50.20");
    process.env.DEPLOYMENT_MODE = "server";
    process.env.PROXY_MODE = "traefik";
    process.env.MYBAY_INSTANCE_ROOT_DOMAIN = "agents.example.test";
    process.env.CONTROL_PANEL_DOMAIN = "console.example.test";
    process.env.LETSENCRYPT_EMAIL = "ci@example.test";

    const config = await getDeploymentModeConfig();

    expect(config.mode).toBe("server");
    expect(config.serverConfigured).toBe(true);
    expect(config.valid).toBe(true);
  });
});
