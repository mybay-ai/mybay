import { describe, expect, it } from "vitest";
import { isPrivilegedUser, parseInstanceConfigJson } from "./instanceConfigRoutePolicy";

describe("instance config route policy characterization", () => {
  it("accepts object and JSON string configs while normalizing empty and array values", () => {
    const objectConfig = { channel: "web" };
    expect(parseInstanceConfigJson(objectConfig)).toBe(objectConfig);
    expect(parseInstanceConfigJson('{"channel":"api"}')).toEqual({ channel: "api" });
    expect(parseInstanceConfigJson("")).toEqual({});
    expect(parseInstanceConfigJson([])).toEqual({});
  });

  it("keeps the existing parse error contract", () => {
    expect(() => parseInstanceConfigJson("{"))
      .toThrow("[parseInstanceConfigJson] Failed to parse config JSON string:");
  });

  it("recognizes only admin roles as privileged", () => {
    expect(isPrivilegedUser({ role: "admin" })).toBe(true);
    expect(isPrivilegedUser({ role: "super_admin" })).toBe(true);
    expect(isPrivilegedUser({ role: "user" })).toBe(false);
    expect(isPrivilegedUser(undefined)).toBe(false);
  });
});

