import dns from "dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSSRFSafe } from "./ssrfValidator";

describe("SSRF validator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects empty, non-HTTP, credential-bearing, and explicit local targets", async () => {
    await expect(checkSSRFSafe("")).resolves.toMatchObject({ safe: false });
    await expect(checkSSRFSafe("file:///etc/passwd")).resolves.toMatchObject({ safe: false });
    await expect(checkSSRFSafe("https://user:password@example.com/v1")).resolves.toMatchObject({ safe: false });
    await expect(checkSSRFSafe("http://127.0.0.1:8080/v1")).resolves.toMatchObject({ safe: false });
    await expect(checkSSRFSafe("http://[::1]:8080/v1")).resolves.toMatchObject({ safe: false });
    await expect(checkSSRFSafe("http://service.local/v1")).resolves.toMatchObject({ safe: false });
  });

  it("rejects a hostname when any resolved address is private", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "10.0.0.5", family: 4 }
    ] as any);

    await expect(checkSSRFSafe("https://models.example.test/v1")).resolves.toMatchObject({ safe: false });
  });

  it("allows a hostname only when every resolved address is public", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 }
    ] as any);

    await expect(checkSSRFSafe("https://models.example.test/v1")).resolves.toEqual({ safe: true });
  });

  it("fails closed when DNS resolution fails", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("lookup failed"));
    await expect(checkSSRFSafe("https://unresolved.example.test/v1")).resolves.toMatchObject({ safe: false });
  });
});
