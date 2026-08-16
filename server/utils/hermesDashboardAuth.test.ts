import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { extractHermesPasswordHash, generateHermesDashboardPasswordHash, HermesDashboardAuthError } from "./hermesDashboardAuth";

describe("Hermes Dashboard password hashing", () => {
  it("generates the native Hermes scrypt format and verifies its derived key", async () => {
    const password = "test-password-123";
    const hash = await generateHermesDashboardPasswordHash(password);
    const [method, n, r, p, saltBase64, keyBase64] = hash.split("$");

    expect(method).toBe("scrypt");
    expect([n, r, p]).toEqual(["16384", "8", "1"]);
    expect(extractHermesPasswordHash('log line\n' + hash + '\n')).toBe(hash);

    const expected = Buffer.from(keyBase64, "base64");
    const actual = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(saltBase64, "base64"), expected.length, {
        N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
      }, (error, key) => error ? reject(error) : resolve(key));
    });
    expect(crypto.timingSafeEqual(actual, expected)).toBe(true);
  });

  it("rejects an empty password", async () => {
    await expect(generateHermesDashboardPasswordHash("")).rejects.toBeInstanceOf(HermesDashboardAuthError);
  });
});
