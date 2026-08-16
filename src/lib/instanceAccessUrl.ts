export function resolveInstanceAccessUrl(rawUrl?: string | null, proxyMode?: string): string | null {
  if (!rawUrl) return null;
  if (typeof window === "undefined" || String(proxyMode || "").toLowerCase() !== "lan") {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const placeholderHost = parsed.hostname === "localhost"
      || parsed.hostname === "127.0.0.1"
      || parsed.hostname.endsWith(".localhost");
    if (placeholderHost) {
      parsed.hostname = window.location.hostname;
      parsed.protocol = "http:";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
}

export function normalizeInstanceAccessUrls<T extends { url?: string | null; public_url?: string | null; proxyMode?: string }>(instance: T): T {
  const resolved = resolveInstanceAccessUrl(instance.url || instance.public_url, instance.proxyMode);
  return { ...instance, url: resolved, public_url: resolved };
}
