import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveInstanceRole, isPrivilegedInstance } from "./instanceRole";

vi.mock("../db", () => ({
  dbAdapter: {
    getUserById: vi.fn()
  }
}));

import { dbAdapter } from "../db";

describe("instanceRole helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return user_role if present", async () => {
    const role = await resolveInstanceRole({ user_role: "admin" });
    expect(role).toBe("admin");
    expect(dbAdapter.getUserById).not.toHaveBeenCalled();
  });

  it("should return owner_role if user_role is missing", async () => {
    const role = await resolveInstanceRole({ owner_role: "super_admin" });
    expect(role).toBe("super_admin");
    expect(dbAdapter.getUserById).not.toHaveBeenCalled();
  });

  it("should fetch user role from db if both roles are missing", async () => {
    vi.mocked(dbAdapter.getUserById).mockResolvedValue({ role: "admin" });
    const role = await resolveInstanceRole({ user_id: "user1" });
    expect(role).toBe("admin");
    expect(dbAdapter.getUserById).toHaveBeenCalledWith("user1");
  });
  
  it("should fetch user role from db using owner_id if user_id is missing", async () => {
    vi.mocked(dbAdapter.getUserById).mockResolvedValue({ role: "super_admin" });
    const role = await resolveInstanceRole({ owner_id: "user2" });
    expect(role).toBe("super_admin");
    expect(dbAdapter.getUserById).toHaveBeenCalledWith("user2");
  });

  it("should return undefined if db query fails or user not found", async () => {
    vi.mocked(dbAdapter.getUserById).mockRejectedValue(new Error("DB error"));
    const role = await resolveInstanceRole({ user_id: "user1" });
    expect(role).toBeUndefined();
  });

  it("isPrivilegedInstance should return true for admin and super_admin", async () => {
    expect(await isPrivilegedInstance({ user_role: "admin" })).toBe(true);
    expect(await isPrivilegedInstance({ user_role: "super_admin" })).toBe(true);
  });

  it("isPrivilegedInstance should return false for others", async () => {
    expect(await isPrivilegedInstance({ user_role: "user" })).toBe(false);
    expect(await isPrivilegedInstance({})).toBe(false);
  });
});
