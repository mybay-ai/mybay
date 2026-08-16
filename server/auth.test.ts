import { describe, it, expect, beforeEach } from "vitest";
import { hashPassword, verifyPassword } from "./utils/crypto";

describe("Authentication & Crypto Unit Tests", () => {
  it("should hash and verify password correctly", () => {
    const password = "my-secret-pass";
    const hashed = hashPassword(password);
    expect(hashed).not.toEqual(password);

    const verification = verifyPassword(password, hashed);
    expect(verification.match).toBe(true);

    const wrongVerification = verifyPassword("wrong-pass", hashed);
    expect(wrongVerification.match).toBe(false);
  });

  it("should reject empty password or invalid hash", () => {
    const verification = verifyPassword("", "");
    expect(verification.match).toBe(false);
  });

  it("should handle rehash requirement when hashing algorithm upgrades", () => {
    const password = "admin-password";
    const hashed = hashPassword(password);
    const verification = verifyPassword(password, hashed);
    expect(verification.match).toBe(true);
    // Same algorithm should not trigger rehash
    expect(verification.needsRehash).toBe(false);
  });
});
