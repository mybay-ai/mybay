import { describe, expect, it } from "vitest";
import { resolvePublishedPortBinding } from "./containerProbe";

function inspectWithBinding(hostIp: string, hostPort = "10101") {
  return {
    NetworkSettings: {
      Ports: {
        "9119/tcp": [{ HostIp: hostIp, HostPort: hostPort }],
      },
    },
  };
}

describe("resolvePublishedPortBinding", () => {
  it("accepts a loopback-only binding in Desktop mode", () => {
    expect(resolvePublishedPortBinding(inspectWithBinding("127.0.0.1"), 9119, 10101, "desktop").ready).toBe(true);
  });

  it("rejects a public binding in Desktop mode", () => {
    expect(resolvePublishedPortBinding(inspectWithBinding("0.0.0.0"), 9119, 10101, "desktop").ready).toBe(false);
  });

  it("accepts an all-interface binding in LAN mode", () => {
    expect(resolvePublishedPortBinding(inspectWithBinding("0.0.0.0"), 9119, 10101, "lan").ready).toBe(true);
  });

  it("rejects a loopback-only binding in LAN mode", () => {
    expect(resolvePublishedPortBinding(inspectWithBinding("127.0.0.1"), 9119, 10101, "lan").ready).toBe(false);
  });

  it("requires the expected host port", () => {
    expect(resolvePublishedPortBinding(inspectWithBinding("127.0.0.1", "10102"), 9119, 10101, "desktop").ready).toBe(false);
  });
});
