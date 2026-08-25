import { URL } from "url";
import { checkSSRFSafe } from "../../utils/ssrfValidator";

export async function isSafeUrl(urlStr: string, allowPrivateNetwork = false): Promise<boolean> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    if (parsed.username || parsed.password) {
      return false;
    }

    if (allowPrivateNetwork) {
      return true;
    }

    const result = await checkSSRFSafe(parsed.toString());
    return result.safe;
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

