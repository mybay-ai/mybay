import { describe, expect, it } from "vitest";
import { resolveWeixinChannelState } from "./gatewayReadiness";

const baseInput = {
  hasCredentials: true,
  logsLower: "",
  pendingAuthorizationCount: 0,
  approvedAuthorizationCount: 0,
  capturedAuthorizationCount: 0,
};

describe("resolveWeixinChannelState", () => {
  it("treats a captured inbound authorization event as durable connection evidence", () => {
    const state = resolveWeixinChannelState({
      ...baseInput,
      approvedAuthorizationCount: 1,
      capturedAuthorizationCount: 1,
    });

    expect(state).toMatchObject({
      configured: true,
      platformLoaded: true,
      transportConnected: true,
      authorizationApproved: true,
      status: "connected",
    });
  });

  it("recognizes the actual Hermes unauthorized Weixin inbound log", () => {
    const state = resolveWeixinChannelState({
      ...baseInput,
      logsLower: "warning gateway.run: unauthorized user: wxid@example on weixin",
      pendingAuthorizationCount: 1,
      capturedAuthorizationCount: 1,
    });

    expect(state.transportConnected).toBe(true);
    expect(state.authorizationApproved).toBe(false);
    expect(state.status).toBe("awaiting_authorization");
  });

  it("keeps credential failures higher priority than captured events", () => {
    const state = resolveWeixinChannelState({
      ...baseInput,
      logsLower: "ilink http 401",
      approvedAuthorizationCount: 1,
      capturedAuthorizationCount: 1,
    });

    expect(state.transportConnected).toBe(false);
    expect(state.status).toBe("auth_failed");
  });

  it("keeps adapter failures higher priority than captured events", () => {
    const state = resolveWeixinChannelState({
      ...baseInput,
      logsLower: "no adapter available for weixin",
      approvedAuthorizationCount: 1,
      capturedAuthorizationCount: 1,
    });

    expect(state.transportConnected).toBe(false);
    expect(state.status).toBe("adapter_failed");
  });

  it("reports missing credentials even if stale logs mention Weixin", () => {
    const state = resolveWeixinChannelState({
      ...baseInput,
      hasCredentials: false,
      logsLower: "weixin connected",
    });

    expect(state).toMatchObject({
      configured: false,
      platformLoaded: false,
      transportConnected: false,
      status: "config_missing",
    });
  });
});
