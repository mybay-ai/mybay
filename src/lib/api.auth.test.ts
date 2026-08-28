import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("authenticated API client", () => {
  const dispatchEvent = vi.fn();
  const fetchMock = vi.fn();

  beforeEach(() => {
    dispatchEvent.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("forces protected API requests to bypass browser caches", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await api.get("/api/instances");

    expect(fetchMock).toHaveBeenCalledWith("/api/instances", expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    }));
  });

  it("broadcasts authentication loss from protected resources", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(api.get("/api/instances")).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
    expect(dispatchEvent.mock.calls[0][0].type).toBe("api-unauthorized");
  });

  it("does not broadcast the expected guest session probe failure", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(api.get("/api/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
