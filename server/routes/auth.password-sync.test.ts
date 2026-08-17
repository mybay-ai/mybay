import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { reconcileConfiguredAdminPassword } from "./auth";

describe("local administrator password reconciliation", () => {
  it("replaces a persisted hash when the configured password changes", () => {
    const oldHash = hashPassword("old-administrator-password");
    const updatedHash = reconcileConfiguredAdminPassword(
      oldHash,
      "new-administrator-password",
    );

    expect(updatedHash).not.toBeNull();
    expect(verifyPassword("new-administrator-password", updatedHash!).match).toBe(true);
    expect(verifyPassword("old-administrator-password", updatedHash!).match).toBe(false);
  });

  it("does not rewrite an up-to-date password hash", () => {
    const currentHash = hashPassword("current-administrator-password");
    expect(
      reconcileConfiguredAdminPassword(currentHash, "current-administrator-password"),
    ).toBeNull();
  });
});