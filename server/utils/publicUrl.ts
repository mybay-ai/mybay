/**
 * MyBay Unified Public URL and Protocol Resolution Utilities
 */

export function normalizeBaseDomain(raw?: string): string {
  const fallback = process.env.MYBAY_INSTANCE_ROOT_DOMAIN || process.env.BASE_DOMAIN || "localhost";
  return (raw || fallback)
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .split(":")[0]
    .trim()
    .replace(/^\.+/, "") || fallback;
}

export function getInstanceRootDomain(): string {
  return normalizeBaseDomain(process.env.MYBAY_INSTANCE_ROOT_DOMAIN || process.env.BASE_DOMAIN);
}

/**
 * Resolves the public base URL of the main MyBay app / console.
 * Priority:
 *   1. PUBLIC_APP_URL
 *   2. APP_PUBLIC_URL
 *   3. SITE_URL
 *   4. BASE_URL
 *   Fallback:
 *     Production: http://localhost:3000
 *     Development: http://localhost:xxxx (where xxxx is process.env.PORT || 3000)
 */
export function getPublicAppUrl(): string {
  const envVal = process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || process.env.SITE_URL || process.env.BASE_URL;
  if (envVal) {
    let url = envVal.trim();
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    // If no protocol is specified, prepend the resolved protocol
    if (!/^https?:\/\//i.test(url)) {
      const isProd = process.env.NODE_ENV === "production";
      const proto = isProd ? "https" : "http";
      url = `${proto}://${url}`;
    }
    return url;
  }

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    return "http://localhost:3000";
  } else {
    const port = process.env.PORT || "3000";
    return `http://localhost:${port}`;
  }
}

/**
 * Resolves the public protocol for individual Hermes Agent instances.
 * Priority:
 *   1. INSTANCE_PUBLIC_PROTOCOL
 *   2. PUBLIC_INSTANCE_PROTOCOL
 *   Fallback:
 *     Production: https
 *     Development: http
 */
export function getInstancePublicProtocol(): string {
  const envVal = process.env.INSTANCE_PUBLIC_PROTOCOL || process.env.PUBLIC_INSTANCE_PROTOCOL;
  if (envVal) {
    return envVal.trim().toLowerCase();
  }
  const isProd = process.env.NODE_ENV === "production";
  return isProd ? "https" : "http";
}

/**
 * Builds the complete public URL for an individual Hermes Agent instance.
 * For example: https://agent-a7bt12.localhost
 * This completely avoids using internal proxy hosts or relative protocols.
 */
export function buildInstancePublicUrl(hostOrSlug: string, hostPort?: number | string, access?: { mode?: string; host?: string }): string {
  const deploymentMode = String(access?.mode || process.env.DEPLOYMENT_MODE || "").toLowerCase();
  const proxyMode = (process.env.PROXY_MODE || "local").toLowerCase();
  if (deploymentMode !== "server" && (proxyMode === "local" || proxyMode === "lan") && hostPort) {
    const configuredHost = access?.host?.trim() || process.env.DEPLOYMENT_LAN_BIND_IP?.trim() || process.env.LOCAL_INSTANCE_ACCESS_HOST?.trim();
    const safeSlug = hostOrSlug.trim().replace(/^https?:\/\//i, "").split(/[.:/]/)[0].replace(/[^a-zA-Z0-9-]/g, "") || "agent";
    const host = configuredHost || (deploymentMode === "lan" || proxyMode === "lan" ? "localhost" : safeSlug + ".localhost");
    return "http://" + host + ":" + hostPort;
  }
  const baseDomain = getInstanceRootDomain();
  let cleanHost = hostOrSlug.trim();
  
  // Extract host if full URL is passed
  try {
    if (/^https?:\/\//i.test(cleanHost)) {
      const parsed = new URL(cleanHost);
      cleanHost = parsed.host;
    }
  } catch {}

  const hostStr = cleanHost.split(":")[0];

  // Extract slug/subdomain
  let slug = "";
  if (hostStr.endsWith(`.${baseDomain}`)) {
    slug = hostStr.substring(0, hostStr.length - baseDomain.length - 1);
  } else {
    slug = hostStr.split(".")[0];
  }

  // If slug is empty or matches baseDomain or is www, fallback to main console app URL
  if (!slug || slug === "www" || hostStr === baseDomain) {
    return getPublicAppUrl();
  }

  const protocol = getInstancePublicProtocol();
  return `${protocol}://${slug}.${baseDomain}`;
}

/**
 * Resolves the redirection target URL safely using the instance public URL.
 */
export function buildRedirectTarget(slug: string, checkUri: string): string {
  const instanceBaseUrl = buildInstancePublicUrl(slug);
  let pathAndQuery = checkUri;
  try {
    if (/^https?:\/\//i.test(checkUri)) {
      const parsed = new URL(checkUri);
      pathAndQuery = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {}

  if (!pathAndQuery.startsWith("/")) {
    pathAndQuery = "/" + pathAndQuery;
  }
  return `${instanceBaseUrl}${pathAndQuery}`;
}
