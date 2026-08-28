function safeDecodeCookieValue(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.trim().split("=");
    if (parts.length >= 2) cookies[parts[0].trim()] = safeDecodeCookieValue(parts.slice(1).join("=").trim());
  });
  return cookies;
}

export function isValidHermesLoginCookieName(name: string): boolean {
  const lower = name.toLowerCase();
  if (["csrf", "state", "redirect", "nonce", "flash"].some((item) => lower.includes(item))) return false;
  return lower.includes("session") || lower.includes("auth");
}

export function hasHermesSessionCookie(cookies: Record<string, string>): boolean {
  return Object.keys(cookies).some((key) => isValidHermesLoginCookieName(key) && Boolean(cookies[key]?.trim()));
}

export function splitCombinedSetCookie(raw: string): string[] {
  return raw.split(/,\s*(?=[^=;\s]+=)/i);
}

export function parseSetCookie(cookieStr: string): { name: string; value: string; maxAge?: string; httpOnly: boolean; secure: boolean } {
  const parts = cookieStr.split(";").map((part) => part.trim());
  const mainPart = parts[0] || "";
  const eqIdx = mainPart.indexOf("=");
  const name = eqIdx > -1 ? mainPart.substring(0, eqIdx).trim() : mainPart;
  const value = eqIdx > -1 ? mainPart.substring(eqIdx + 1).trim() : "";
  let maxAge: string | undefined;
  let httpOnly = false;
  let secure = false;
  for (const part of parts.slice(1)) {
    const lower = part.toLowerCase();
    if (lower.startsWith("max-age=")) maxAge = part.substring("max-age=".length).trim();
    else if (lower === "httponly") httpOnly = true;
    else if (lower === "secure") secure = true;
  }
  return { name, value, maxAge, httpOnly, secure };
}

export function rewriteHermesCookieHostOnly(cookieStr: string, isProd: boolean): string | null {
  const { name, value, maxAge, httpOnly } = parseSetCookie(cookieStr);
  if (!name || !value) return null;
  const parts = [`${name}=${value}`, "Path=/"];
  if (httpOnly) parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

export { safeDecodeCookieValue };
