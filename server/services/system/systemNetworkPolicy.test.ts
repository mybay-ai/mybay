import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSystemRequestError, isSafeUrl, safeOutboundFetch } from "./systemNetworkPolicy";

describe("system network policy characterization", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["http", true],
    ["http", false],
    ["https", true],
    ["https", false],
  ] as const)("pins %s DNS using the callback shape requested by all=%s", async (protocol, all) => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ] as any);
    const request = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() });
    let capturedOptions: any;
    vi.spyOn(protocol === "https" ? https : http, "request").mockImplementation(((options: any, receive: any) => {
      capturedOptions = options;
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200, statusMessage: "OK", headers: {} });
        receive(response);
        response.emit("data", Buffer.from("OK"));
        response.emit("end");
      });
      return request;
    }) as any);

    const response = await safeOutboundFetch(`${protocol}://example.com/test`);
    expect(await response.text()).toBe("OK");
    const callback = vi.fn();
    capturedOptions.lookup("example.com", { all }, callback);
    if (all) {
      expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    } else {
      expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    }
    expect(capturedOptions.hostname).toBe("example.com");
    if (protocol === "https") expect(capturedOptions.servername).toBe("example.com");
  });

  it("rejects a private address introduced by DNS rebinding before transport", async () => {
    vi.spyOn(dns.promises, "lookup")
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any)
      .mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ] as any);
    const request = vi.spyOn(https, "request");
    await expect(safeOutboundFetch("https://example.com/test")).rejects.toThrow("restricted network");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects non-http and explicit local targets", async () => {
    await expect(isSafeUrl("file:///etc/passwd")).resolves.toBe(false);
    await expect(isSafeUrl("http://localhost/test")).resolves.toBe(false);
    await expect(isSafeUrl("http://127.0.0.1/test")).resolves.toBe(false);
  });

  it("preserves the private-network override after protocol validation", async () => {
    await expect(isSafeUrl("http://localhost/test", true)).resolves.toBe(true);
    await expect(isSafeUrl("javascript:alert(1)", true)).resolves.toBe(false);
  });

  it("rejects unsafe outbound requests before opening a connection", async () => {
    await expect(safeOutboundFetch("http://127.0.0.1/admin")).rejects.toThrow(/SSRF|restricted|内网/);
    await expect(safeOutboundFetch("file:///etc/passwd")).rejects.toThrow("Unsupported outbound protocol");
    await expect(safeOutboundFetch("https://user:password@example.com/")).rejects.toThrow("credentials");
  });

  it("preserves bounded error formatting and cause context", () => {
    expect(formatSystemRequestError({ message: "failed", cause: new Error("socket closed") }))
      .toBe("failed (原因: socket closed)");
    expect(formatSystemRequestError({ message: "x".repeat(600) }).length).toBe(500);
  });
});

