import { describe, expect, it } from "vitest";
import {
  collectReservedInstancePorts,
  disableCredentiallessA2AForRestore,
  isContainerlessInstanceEligibleForDeployment,
} from "./configArchiveRestorePolicy";

describe("config archive restore policy", () => {
  it("collects unique valid ports from records and serialized config", () => {
    expect(collectReservedInstancePorts([
      { host_port: 10100, config_json: JSON.stringify({ port: "10101" }) },
      { port: "10102", config_json: JSON.stringify({ host_port: 10100 }) },
      { host_port: "invalid", config_json: "not-json" },
    ])).toEqual([10100, 10101, 10102]);
  });

  it("allows stopped or failed containerless records to enter initial deployment", () => {
    expect(isContainerlessInstanceEligibleForDeployment({ status: "stopped" })).toBe(true);
    expect(isContainerlessInstanceEligibleForDeployment({ status: "error" })).toBe(true);
    expect(isContainerlessInstanceEligibleForDeployment({ status: "running" })).toBe(false);
    expect(isContainerlessInstanceEligibleForDeployment({ status: "stopped", container_id: "abc" })).toBe(false);
    expect(isContainerlessInstanceEligibleForDeployment({ status: "stopped", container_name: "agent" })).toBe(false);
  });

  it("disables restored A2A when its excluded token is unavailable", () => {
    const config = { a2aEnabled: true, a2aPeerIds: ["peer"], hasA2aBearerToken: true };
    expect(disableCredentiallessA2AForRestore(config)).toBe(true);
    expect(config).toMatchObject({ a2aEnabled: false, a2aPeerIds: [], hasA2aBearerToken: false });

    const configured = { a2aEnabled: true, a2aBearerToken: "encrypted:new-token" };
    expect(disableCredentiallessA2AForRestore(configured)).toBe(false);
    expect(configured.a2aEnabled).toBe(true);
  });
});
