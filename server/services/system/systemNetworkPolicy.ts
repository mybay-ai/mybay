import dns from "dns";
import { promisify } from "util";
import { URL } from "url";

const lookupAsync = promisify(dns.lookup);

export async function isSafeUrl(urlStr: string, allowPrivateNetwork = false): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    if (allowPrivateNetwork) {
      return true;
    }

    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[]") {
      return false;
    }

    try {
      const res = await lookupAsync(host);
      const ip = res.address;

      const parts = ip.split(".").map(Number);
      if (parts.length === 4) {
        const [a, b] = parts;
        if (a === 10) return false;
        if (a === 172 && (b >= 16 && b <= 31)) return false;
        if (a === 192 && b === 168) return false;
        if (a === 127 || (a === 169 && b === 254) || a >= 224) return false;
      }
    } catch {
      // Preserve the existing fail-open behavior for unresolved public hostnames.
    }

    return true;
  } catch {
    return false;
  }
}

export function formatSystemRequestError(err: any): string {
  let msg = err.message ? err.message.substring(0, 500) : String(err).substring(0, 500);
  if (err.cause) {
    const causeMsg = err.cause.message || String(err.cause);
    msg += ` (原因: ${causeMsg})`;
  }
  return msg;
}

