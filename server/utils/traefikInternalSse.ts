import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { validateHermesSessionId, validateInstanceId } from "./traefikInternalRequest";
import { parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import { resolveLocalInstanceTarget } from "./localInstanceTarget";

export interface TraefikSseOptions {
  instanceId: string;
  path: string;
  apiKey: string;
  signal?: AbortSignal;
  inactivityTimeoutMs?: number;
  onOpen?: (statusCode: number, headers: http.IncomingHttpHeaders) => void;
  onChunk: (chunk: string) => void;
  hermesSessionId?: string;
}

export interface TraefikSseResult {
  ok: boolean;
  statusCode: number;
  error?: string;
}

/**
 * Open a bounded, authenticated SSE connection through the private Traefik
 * route. Raw upstream data is never logged or returned in errors.
 */
export async function streamTraefikInternalSse(options: TraefikSseOptions): Promise<TraefikSseResult> {
  const { instanceId, path, apiKey, signal, onOpen, onChunk, hermesSessionId } = options;
  const { isLocal } = parseTraefikEnv(process.env);
  if (!validateInstanceId(instanceId) || !/^\/v1\/runs\/[A-Za-z0-9_.-]{1,128}\/events$/.test(path)) {
    return Promise.resolve({ ok: false, statusCode: 400, error: "INVALID_STREAM_TARGET" });
  }

  const routingSecret = process.env.MYBAY_INTERNAL_ROUTING_SECRET;
  if (!routingSecret && process.env.NODE_ENV === "production" && !isLocal) {
    return Promise.resolve({ ok: false, statusCode: 500, error: "INTERNAL_ROUTING_SECRET_MISSING" });
  }

  let protocol: "http:" | "https:";
  let hostname: string;
  let port: number;
  let basePath = "";
  if (isLocal) {
    try {
      const target = await resolveLocalInstanceTarget(instanceId);
      protocol = target.protocol;
      hostname = target.hostname;
      port = target.port;
    } catch {
      return { ok: false, statusCode: 503, error: "INTERNAL_ROUTE_CONNECT_FAILED" };
    }
  } else {
    let baseUrl: URL;
    try {
      baseUrl = new URL(process.env.TRAEFIK_INTERNAL_URL || "http://traefik/");
      if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      return { ok: false, statusCode: 500, error: "INVALID_TRAEFIK_INTERNAL_URL" };
    }
    protocol = baseUrl.protocol;
    hostname = baseUrl.hostname;
    port = baseUrl.port ? Number(baseUrl.port) : (protocol === "https:" ? 443 : 80);
    basePath = baseUrl.pathname.replace(/\/$/, "");
  }
  const client = protocol === "https:" ? https : http;
  const routeName = "mybay-internal-api-" + instanceId + ".internal";
  const resolvedPath = basePath + "/" + path.replace(/^\//, "");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TraefikSseResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };

    const req = client.request({
      method: "GET",
      hostname,
      port,
      path: resolvedPath,
      headers: {
        Host: isLocal ? "localhost" : routeName,
        Accept: "text/event-stream",
        Authorization: `Bearer ${apiKey}`,
        ...(routingSecret ? { "X-MyBay-Internal-Routing": routingSecret } : {}),
        ...(hermesSessionId && validateHermesSessionId(hermesSessionId) ? { "X-Hermes-Session-Id": hermesSessionId } : {})
      }
    }, (res) => {
      const statusCode = res.statusCode || 0;
      onOpen?.(statusCode, res.headers);

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        finish({ ok: false, statusCode, error: "UPSTREAM_SSE_REJECTED" });
        return;
      }

      const contentType = String(res.headers["content-type"] || "").toLowerCase();
      if (!contentType.includes("text/event-stream")) {
        res.resume();
        finish({ ok: false, statusCode: 502, error: "INVALID_UPSTREAM_SSE" });
        return;
      }

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        if (!settled && chunk.length <= 1024 * 1024) onChunk(chunk);
      });
      res.on("end", () => finish({ ok: true, statusCode }));
      res.on("error", () => finish({ ok: false, statusCode: 0, error: "UPSTREAM_SSE_DISCONNECTED" }));
    });

    const abort = () => {
      req.destroy();
      finish({ ok: false, statusCode: 0, error: "ABORTED" });
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    req.setTimeout(options.inactivityTimeoutMs || 45000, () => {
      req.destroy();
      finish({ ok: false, statusCode: 0, error: "UPSTREAM_SSE_TIMEOUT" });
    });
    req.on("error", () => finish({ ok: false, statusCode: 0, error: "UPSTREAM_SSE_CONNECT_FAILED" }));
    req.end();
  });
}
