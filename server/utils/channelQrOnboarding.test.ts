import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelChannelQrSession, getChannelQrSession, publicChannelQrSession, startChannelQrSession } from "./channelQrOnboarding";

describe("WeChat QR onboarding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a pending session when the iLink QR endpoint succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ret: 0, qrcode: "opaque-code", qrcode_img_content: "https://example.test/qr" }),
    }));

    const session = await startChannelQrSession("user-success", "weixin");
    expect(publicChannelQrSession(session)).toMatchObject({
      channel: "weixin",
      status: "pending",
      qrUrl: "https://example.test/qr",
    });
    cancelChannelQrSession("user-success", session.id);
  });

  it("reports Docker DNS failures separately from expired QR codes", async () => {
    const networkError = new TypeError("fetch failed") as TypeError & { cause?: { code: string } };
    networkError.cause = { code: "EAI_AGAIN" };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const session = await startChannelQrSession("user-dns", "weixin");
    expect(publicChannelQrSession(session)).toMatchObject({
      channel: "weixin",
      status: "failed",
      errorCode: "WEIXIN_QR_NETWORK_FAILED",
    });
  });
});

describe("shared Feishu QR results", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it.each(["ou_scan_user", "invalid-id", undefined])("preserves app credentials and only returns a valid Open ID: %s", async openId => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ supported_auth_methods: ["client_secret"] }) })
      .mockResolvedValueOnce({ json: async () => ({ device_code: "device-test", verification_uri_complete: "https://open.feishu.cn/page/cli?user_code=test", interval: 2 }) })
      .mockResolvedValueOnce({ json: async () => ({ client_id: "cli_test", client_secret: "test-secret", user_info: { open_id: openId } }) });
    vi.stubGlobal("fetch", fetchMock);
    const session = await startChannelQrSession("owner", "feishu");
    expect(session.qrUrl).toContain("from=hermes");
    expect(getChannelQrSession("other-user", session.id)).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(publicChannelQrSession(session)).toMatchObject({ status: "completed", result: { feishuAppId: "cli_test", feishuAppSecret: "test-secret", feishuRegion: "feishu" } });
    expect(session.result?.feishuUserOpenId).toBe(openId === "ou_scan_user" ? openId : undefined);
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get("request_user_info")).toBe("open_id");
    cancelChannelQrSession("owner", session.id);
  });
});
