import { tryResolvePlainInstancePassword } from "../../crypto";

/**
 * Pure Traefik Configuration Module
 * Handles proxy mode resolution, label generation, and routing configurations purely via inputs.
 */

export interface TraefikEnvConfig {
  proxyMode: string;
  isTraefik: boolean;
  isLocal: boolean;
  traefikNetwork: string;
  traefikContainerName: string;
  traefikInternalUrl: string;
}

export function parseTraefikEnv(env: NodeJS.ProcessEnv): TraefikEnvConfig {
  const proxyMode = (env.PROXY_MODE || 'local').toLowerCase();
  return {
    proxyMode,
    isTraefik: proxyMode === 'traefik',
    isLocal: proxyMode === 'local' || proxyMode === 'lan',
    traefikNetwork: env.TRAEFIK_NETWORK || 'traefik_proxy',
    traefikContainerName: env.TRAEFIK_CONTAINER_NAME || 'traefik',
    traefikInternalUrl: env.TRAEFIK_INTERNAL_URL || 'http://traefik/'
  };
}

export function getTraefikRouterName(instanceId: string): string {
  return `hermes-${instanceId}`;
}

export function getTraefikHostRule(subdomain: string, userRole?: string, enableDashboard: boolean = true): string {
  let rule = `Host(\`${subdomain}\`)`;
  if (userRole !== "admin" && userRole !== "super_admin") {
    rule += ` && !PathPrefix(\`/api/files\`) && !PathPrefix(\`/files\`) && !PathPrefix(\`/workspace\`)`;
  }
  
  if (enableDashboard === false) {
    rule += ` && (PathPrefix(\`/oauth\`) || PathPrefix(\`/callback\`) || PathPrefix(\`/lark\`) || PathPrefix(\`/wechat\`) || PathPrefix(\`/wechat_mp\`) || PathPrefix(\`/wecom\`) || PathPrefix(\`/dingtalk\`) || PathPrefix(\`/socket.io\`) || PathPrefix(\`/api/channels\`) || PathPrefix(\`/api/webhook\`) || PathPrefix(\`/api/callback\`) || PathPrefix(\`/api/oauth\`))`;
  }
  return rule;
}

export function getTraefikAuthMiddlewareName(routerName: string): string {
  return `${routerName}-auth`;
}

export interface TraefikLabelConfig {
  internal_web_port?: string | number;
  username?: string;
  webPasswordHash?: string;
  enableDashboard?: boolean;
  password?: string;
}

export function generateTraefikLabels(
  instanceId: string, 
  subdomain: string, 
  config: TraefikLabelConfig, 
  network: string,
  userRole?: string
): { [key: string]: string } {
  const routerName = getTraefikRouterName(instanceId);
  const internalPort = String(config?.internal_web_port || "9119");
  const enableDashboard = config?.enableDashboard ?? true;
  
  const isPublicApiEnabled = (config as any)?.channel === "api" || (config as any)?.publicApiEnabled === true || (config as any)?.exposeApi === true || (config as any)?.publicApiEnabled === "true" || (config as any)?.exposeApi === "true";
  const isWebhookEnabled = (config as any)?.channel === "webhook" || (config as any)?.WEBHOOK_ENABLED === "true" || (config as any)?.WEBHOOK_ENABLED === true;

  let whitelistRuleSuffix = `(PathPrefix(\`/oauth\`) || PathPrefix(\`/callback\`) || PathPrefix(\`/lark\`) || PathPrefix(\`/wechat\`) || PathPrefix(\`/wechat_mp\`) || PathPrefix(\`/wecom\`) || PathPrefix(\`/dingtalk\`) || PathPrefix(\`/socket.io\`) || PathPrefix(\`/api/channels\`) || PathPrefix(\`/api/webhook\`) || PathPrefix(\`/api/callback\`) || PathPrefix(\`/api/oauth\`)`;
  let blacklistRuleSuffix = `!PathPrefix(\`/v1\`) && !PathPrefix(\`/oauth\`) && !PathPrefix(\`/callback\`) && !PathPrefix(\`/lark\`) && !PathPrefix(\`/wechat\`) && !PathPrefix(\`/wechat_mp\`) && !PathPrefix(\`/wecom\`) && !PathPrefix(\`/dingtalk\`) && !PathPrefix(\`/socket.io\`) && !PathPrefix(\`/api/channels\`) && !PathPrefix(\`/api/webhook\`) && !PathPrefix(\`/api/callback\`) && !PathPrefix(\`/api/oauth\`)`;

  if (isWebhookEnabled) {
    blacklistRuleSuffix += ` && !PathPrefix(\`/webhook\`) && !PathPrefix(\`/webhooks\`)`;
  }

  whitelistRuleSuffix += `)`;

  const labels: { [key: string]: string } = {
    "traefik.enable": "true",
    "traefik.docker.network": network,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: internalPort,
  };

  // Always expose the 8642 API service for both public (if enabled) and internal API routes
  labels[`traefik.http.services.${routerName}-api.loadbalancer.server.port`] = "8642";

  if (isPublicApiEnabled) {
    const apiRouterName = `${routerName}-api`;
    const apiRule = `Host(\`${subdomain}\`) && PathPrefix(\`/v1\`)`;
    labels[`traefik.http.routers.${apiRouterName}.rule`] = apiRule;
    labels[`traefik.http.routers.${apiRouterName}.entrypoints`] = "web";
    labels[`traefik.http.routers.${apiRouterName}.service`] = `${routerName}-api`;

    labels[`traefik.http.routers.${apiRouterName}-secure.rule`] = apiRule;
    labels[`traefik.http.routers.${apiRouterName}-secure.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${apiRouterName}-secure.tls`] = "true";
    labels[`traefik.http.routers.${apiRouterName}-secure.service`] = `${routerName}-api`;
  }

  // Add an internal Traefik route specifically for the background console
  const internalSecret = process.env.MYBAY_INTERNAL_ROUTING_SECRET;
  if (!internalSecret) {
    const errorMsg = "[Security Error] MYBAY_INTERNAL_ROUTING_SECRET is not set! Cannot create internal routing securely.";
    if (process.env.NODE_ENV === "production") {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg + " Skipping internal-api route generation.");
    }
  } else {
    const internalApiRouterName = `${routerName}-internal-api`;
    const internalApiRule = `Host(\`mybay-internal-api-${instanceId}.internal\`) && PathPrefix(\`/v1\`) && Header(\`X-MyBay-Internal-Routing\`, \`${internalSecret}\`)`;
    labels[`traefik.http.routers.${internalApiRouterName}.rule`] = internalApiRule;
    labels[`traefik.http.routers.${internalApiRouterName}.entrypoints`] = "web";
    labels[`traefik.http.routers.${internalApiRouterName}.service`] = `${routerName}-api`;
    labels[`traefik.http.routers.${internalApiRouterName}.priority`] = "10000";

    const defaultRanges = "127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";
    let internalAllowlistRanges = defaultRanges;
    if (process.env.MYBAY_INTERNAL_ALLOWLIST_RANGE) {
      const custom = process.env.MYBAY_INTERNAL_ALLOWLIST_RANGE.split(',').map(s => s.trim()).filter(Boolean);
      const defaults = defaultRanges.split(',');
      internalAllowlistRanges = Array.from(new Set([...defaults, ...custom])).join(',');
    }

    const internalAllowlistName = `${routerName}-internal-allowlist`;
    labels[`traefik.http.middlewares.${internalAllowlistName}.ipallowlist.sourcerange`] = internalAllowlistRanges;
    labels[`traefik.http.routers.${internalApiRouterName}.middlewares`] = internalAllowlistName;
  }

  if (isWebhookEnabled) {
    labels[`traefik.http.services.${routerName}-webhook.loadbalancer.server.port`] = "8644";

    const webhookRouterName = `${routerName}-webhook`;
    const webhookRule = `Host(\`${subdomain}\`) && (PathPrefix(\`/webhooks\`) || PathPrefix(\`/webhook\`))`;
    labels[`traefik.http.routers.${webhookRouterName}.rule`] = webhookRule;
    labels[`traefik.http.routers.${webhookRouterName}.entrypoints`] = "web";
    labels[`traefik.http.routers.${webhookRouterName}.service`] = `${routerName}-webhook`;

    labels[`traefik.http.routers.${webhookRouterName}-secure.rule`] = webhookRule;
    labels[`traefik.http.routers.${webhookRouterName}-secure.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${webhookRouterName}-secure.tls`] = "true";
    labels[`traefik.http.routers.${webhookRouterName}-secure.service`] = `${routerName}-webhook`;
  }

  if (enableDashboard !== false) {
    if (!config?.webPasswordHash) {
      console.error(`[Security Warning] Instance ${subdomain} has Dashboard enabled on 0.0.0.0 but lacks webPasswordHash! Rejecting insecure deployment.`);
      throw new Error("检测到实例启用了 Web UI 访问但未配置访问保护密码。为了您的安全，禁止部署无密码保护的公网 Web UI 路由。请在控制台为实例设置访问保护密码。");
    }
    const plainPassword = tryResolvePlainInstancePassword(config);
    if (!plainPassword) {
      throw new Error("新版 Hermes Dashboard 绑定 0.0.0.0 时必须配置 Basic Auth。请为实例设置访问保护密码后重新部署。");
    }
  }

  // 1. Public/Bypass router for whitelisted paths - ALWAYS bypasses forwardAuth
  const publicRouterName = `${routerName}-public`;
  const publicRule = `Host(\`${subdomain}\`) && ${whitelistRuleSuffix}`;
  labels[`traefik.http.routers.${publicRouterName}.rule`] = publicRule;
  labels[`traefik.http.routers.${publicRouterName}.entrypoints`] = "web";
  labels[`traefik.http.routers.${publicRouterName}.service`] = routerName;

  // 1b. Public/Bypass HTTPS secure router
  labels[`traefik.http.routers.${publicRouterName}-secure.rule`] = publicRule;
  labels[`traefik.http.routers.${publicRouterName}-secure.entrypoints`] = "websecure";
  labels[`traefik.http.routers.${publicRouterName}-secure.tls`] = "true";
  labels[`traefik.http.routers.${publicRouterName}-secure.service`] = routerName;

  // 1c. High priority session complete router for /__mybay/session-complete
  const consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL || "http://mybay-console-active:15928";
  let consoleHost = "mybay-console-active";
  let consolePort = "15928";
  try {
    const u = new URL(consoleInternalUrl);
    consoleHost = u.hostname;
    consolePort = u.port || (u.protocol === "https:" ? "443" : "80");
  } catch (e) {}

  const mybayRouterName = `${routerName}-mybay`;
  const mybayRule = `Host(\`${subdomain}\`) && PathPrefix(\`/__mybay/session-complete\`)`;
  const consoleServiceRef = "mybay-console-service@file";

  labels[`traefik.http.routers.${mybayRouterName}.rule`] = mybayRule;
  labels[`traefik.http.routers.${mybayRouterName}.entrypoints`] = "web";
  labels[`traefik.http.routers.${mybayRouterName}.priority`] = "9999";
  labels[`traefik.http.routers.${mybayRouterName}.service`] = consoleServiceRef;

  labels[`traefik.http.routers.${mybayRouterName}-secure.rule`] = mybayRule;
  labels[`traefik.http.routers.${mybayRouterName}-secure.entrypoints`] = "websecure";
  labels[`traefik.http.routers.${mybayRouterName}-secure.tls`] = "true";
  labels[`traefik.http.routers.${mybayRouterName}-secure.priority`] = "9999";
  labels[`traefik.http.routers.${mybayRouterName}-secure.service`] = consoleServiceRef;

  // 2. Standard/Dashboard router - ONLY created when enableDashboard is true, handles remaining paths with potential forwardAuth
  if (enableDashboard !== false) {
    let normalRule = `Host(\`${subdomain}\`) && ${blacklistRuleSuffix}`;
    if (userRole !== "admin" && userRole !== "super_admin") {
      normalRule += ` && !PathPrefix(\`/api/files\`) && !PathPrefix(\`/files\`) && !PathPrefix(\`/workspace\`)`;
    }
    labels[`traefik.http.routers.${routerName}.rule`] = normalRule;
    labels[`traefik.http.routers.${routerName}.entrypoints`] = "web";
    labels[`traefik.http.routers.${routerName}.service`] = routerName;

    const middlewares: string[] = [];

    if (config?.webPasswordHash) {
      const authMiddlewareName = getTraefikAuthMiddlewareName(routerName);
      let consoleInternalUrl = process.env.INSTANCE_AUTH_INTERNAL_URL || process.env.CONTROL_PLANE_INTERNAL_URL;
      if (!consoleInternalUrl) {
        throw new Error("Missing required environment variable INSTANCE_AUTH_INTERNAL_URL or CONTROL_PLANE_INTERNAL_URL for protected instance forwardauth");
      }

      labels[`traefik.http.middlewares.${authMiddlewareName}.forwardauth.address`] = `${consoleInternalUrl}/api/public/instances/auth-check`;
      labels[`traefik.http.middlewares.${authMiddlewareName}.forwardauth.trustForwardHeader`] = "true";
      middlewares.push(authMiddlewareName);

      const plainPassword = tryResolvePlainInstancePassword(config);
      if (plainPassword) {
        const username = config?.username || "admin";
        const authHeaderVal = "Basic " + Buffer.from(`${username}:${plainPassword}`).toString("base64");
        const headersMiddlewareName = `${routerName}-headers`;
        labels[`traefik.http.middlewares.${headersMiddlewareName}.headers.customrequestheaders.Authorization`] = authHeaderVal;
        middlewares.push(headersMiddlewareName);
      }
    }

    if (middlewares.length > 0) {
      labels[`traefik.http.routers.${routerName}.middlewares`] = middlewares.join(",");
    }

    // 2b. Standard/Dashboard HTTPS secure router
    labels[`traefik.http.routers.${routerName}-secure.rule`] = normalRule;
    labels[`traefik.http.routers.${routerName}-secure.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${routerName}-secure.tls`] = "true";
    labels[`traefik.http.routers.${routerName}-secure.service`] = routerName;
    if (middlewares.length > 0) {
      labels[`traefik.http.routers.${routerName}-secure.middlewares`] = middlewares.join(",");
    }
  }

  return labels;
}
