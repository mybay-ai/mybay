import { describe, expect, it } from "vitest";
import { formatSystemRequestError, isSafeUrl } from "./systemNetworkPolicy";

describe("system network policy characterization", () => {
  it("rejects non-http and explicit local targets", async () => {
    await expect(isSafeUrl("file:///etc/passwd")).resolves.toBe(false);
    await expect(isSafeUrl("http://localhost/test")).resolves.toBe(false);
    await expect(isSafeUrl("http://127.0.0.1/test")).resolves.toBe(false);
  });

  it("preserves the private-network override after protocol validation", async () => {
    await expect(isSafeUrl("http://localhost/test", true)).resolves.toBe(true);
    await expect(isSafeUrl("javascript:alert(1)", true)).resolves.toBe(false);
  });

  it("preserves bounded error formatting and cause context", () => {
    expect(formatSystemRequestError({ message: "failed", cause: new Error("socket closed") }))
      .toBe("failed (原因: socket closed)");
    expect(formatSystemRequestError({ message: "x".repeat(600) }).length).toBe(500);
  });
});

