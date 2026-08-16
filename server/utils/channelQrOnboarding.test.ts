import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelChannelQrSession, publicChannelQrSession, startChannelQrSession } from "./channelQrOnboarding";

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
