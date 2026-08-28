export type WeixinChannelState = {
  configured: boolean;
  platformLoaded: boolean;
  transportConnected: boolean;
  authorizationRequired: boolean;
  authorizationApproved: boolean | null;
  status: string;
  reason: string;
};

export function hasGatewayRuntimeEvidence(input: {
  gatewayServices: Record<string, string>;
  hasSuccessfulHttpProbe: boolean;
  hasLogRunningEvidence: boolean;
  connectedChannels: number;
}): boolean {
  const services = input.gatewayServices || {};
  const s6GatewayRunning = (
    services["main_hermes"] === "running"
    || services["gateway_default"] === "running"
    || services["gateway"] === "running"
    || services["dashboard"] === "running"
  );
  return s6GatewayRunning
    || input.hasSuccessfulHttpProbe
    || input.hasLogRunningEvidence
    || input.connectedChannels > 0;
}

export function resolveWeixinChannelState(input: {
  hasCredentials: boolean;
  logsLower: string;
  pendingAuthorizationCount: number;
  approvedAuthorizationCount: number;
  capturedAuthorizationCount: number;
}): WeixinChannelState {
  const { hasCredentials, logsLower, pendingAuthorizationCount, approvedAuthorizationCount, capturedAuthorizationCount } = input;
  const isAuthError = ["weixin auth failed", "weixin token invalid", "ilink unauthorized", "ilink http 401"]
    .some((keyword) => logsLower.includes(keyword));
  const adapterFailed = logsLower.includes("no adapter available for weixin") || logsLower.includes("weixin adapter failed");
  const hasExplicitConnectedLog = ["[weixin] connected", "weixin connected", "weixin ready", "connected to weixin", "weixin gateway ready"]
    .some((keyword) => logsLower.includes(keyword));
  const hasInboundActivity = [" on weixin", "weixin inbound", "weixin message", "weixin update", "received weixin"]
    .some((keyword) => logsLower.includes(keyword));
  const isConnecting = ["weixin starting", "connecting to weixin", "initializing weixin", "ilink bot starting"]
    .some((keyword) => logsLower.includes(keyword));
  const hasInboundEvidence = hasInboundActivity || capturedAuthorizationCount > 0;
  const isConnected = hasExplicitConnectedLog || hasInboundEvidence;
  const runtimeEvidence = isConnected || isConnecting || isAuthError || adapterFailed || logsLower.includes("weixin") || logsLower.includes("ilink");
  const platformLoaded = hasCredentials && runtimeEvidence;
  const transportConnected = hasCredentials && isConnected && !adapterFailed && !isAuthError;

  if (!hasCredentials) {
    return { configured: false, platformLoaded: false, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "config_missing", reason: "Personal WeChat iLink credentials are missing" };
  }
  if (adapterFailed) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "adapter_failed", reason: "Personal WeChat adapter failed to load" };
  }
  if (isAuthError) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "auth_failed", reason: "Personal WeChat iLink credentials were rejected" };
  }
  if (transportConnected) {
    if (pendingAuthorizationCount > 0) {
      return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: false, status: "awaiting_authorization", reason: `Personal WeChat is connected; ${pendingAuthorizationCount} authorization request(s) pending` };
    }
    if (approvedAuthorizationCount > 0) {
      return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: true, status: "connected", reason: "Personal WeChat connected and approved" };
    }
    return { configured: true, platformLoaded: true, transportConnected: true, authorizationRequired: true, authorizationApproved: false, status: "awaiting_authorization", reason: "Personal WeChat is connected; waiting for authorization" };
  }
  if (isConnecting) {
    return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "starting", reason: "Personal WeChat iLink connection is starting" };
  }
  return { configured: true, platformLoaded, transportConnected: false, authorizationRequired: true, authorizationApproved: null, status: "connection_failed", reason: "Personal WeChat iLink connection is not ready" };
}
