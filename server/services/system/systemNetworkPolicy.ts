import { URL } from "url";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { checkSSRFSafe } from "../../utils/ssrfValidator";

const MAX_OUTBOUND_RESPONSE_BYTES = 2 * 1024 * 1024;

function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

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

/**
 * Performs an outbound HTTP request while pinning the connection to an IP that
 * was validated immediately before use. This closes the DNS-rebinding window
 * left by a separate "validate, then fetch" flow and rejects redirects so a
 * trusted endpoint cannot bounce the request into a private network.
 */
export async function safeOutboundFetch(urlStr: string, init: RequestInit = {}): Promise<Response> {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported outbound protocol");
  if (parsed.username || parsed.password) throw new Error("Outbound URL credentials are not allowed");
  const policy = await checkSSRFSafe(parsed.toString());
  if (!policy.safe) throw new Error(policy.error || "Outbound URL rejected by SSRF policy");

  const records = await dns.promises.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error("Outbound host resolved to a restricted network address");
  }
  const pinned = records[0];
  const transport = parsed.protocol === "https:" ? https : http;

  return await new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    const body = init.body;
    // DNS is re-resolved, every address is required to be public, and the
    // connection is pinned to that checked address. lgtm[js/request-forgery]
    const request = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      method: init.method || "GET",
      path: `${parsed.pathname}${parsed.search}`,
      headers: Object.fromEntries(headers.entries()),
      lookup: (_hostname, _options, callback: any) => callback(null, pinned.address, pinned.family),
      ...(parsed.protocol === "https:" ? { servername: parsed.hostname } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTBOUND_RESPONSE_BYTES) {
          request.destroy(new Error("Outbound response exceeded the size limit"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, String(value));
        }
        const status = response.statusCode || 500;
        const responseBody = [101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        resolve(new Response(responseBody, {
          status,
          statusText: response.statusMessage,
          headers: responseHeaders,
        }));
      });
    });
    request.on("error", reject);

    const abort = () => request.destroy(new DOMException("The operation was aborted", "AbortError"));
    if (init.signal?.aborted) return abort();
    init.signal?.addEventListener("abort", abort, { once: true });

    if (typeof body === "string" || body instanceof Uint8Array) request.write(body);
    else if (body instanceof URLSearchParams) request.write(body.toString());
    else if (body !== undefined && body !== null) {
      request.destroy(new Error("Unsupported outbound request body type"));
      return;
    }
    request.end();
  });
}

export function formatSystemRequestError(err: any): string {
  let msg = err.message ? err.message.substring(0, 500) : String(err).substring(0, 500);
  if (err.cause) {
    const causeMsg = err.cause.message || String(err.cause);
    msg += ` (原因: ${causeMsg})`;
  }
  return msg;
}

