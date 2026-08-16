import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { parseTraefikEnv } from "../infrastructure/traefik/traefikConfig";
import { resolveLocalInstanceTarget } from "./localInstanceTarget";

export interface TraefikRequestOptions {
  instanceId: string;
  method: string;
  path: string;
  apiKey?: string;
  body?: any;
  timeoutMs: number;
  maxResponseBytes?: number;
  hermesSessionId?: string;
  headers?: Record<string, string>;
}

export interface TraefikRequestResult {
  ok: boolean;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  json?: any;
  durationMs: number;
  routeName: string;
  error?: string;
}

export function validateInstanceId(instanceId: string): boolean {
  if (typeof instanceId !== "string") return false;
  return /^[A-Za-z0-9-]{1,128}$/.test(instanceId);
}

export function validateHermesSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(sessionId);
}

export async function requestTraefikInternal(options: TraefikRequestOptions): Promise<TraefikRequestResult> {
  const startTime = Date.now();
  const { isLocal } = parseTraefikEnv(process.env);
  const { instanceId, method, path, apiKey, body, timeoutMs, maxResponseBytes, hermesSessionId } = options;
  const routeName = `mybay-internal-api-${instanceId}.internal`;

  // 1. Validate instance ID structure strictly (no spaces, CRLF, slashes, colons, etc.)
  if (!validateInstanceId(instanceId)) {
    return Promise.resolve({
      ok: false,
      statusCode: 400,
      headers: {},
      rawBody: "INVALID_INSTANCE_ID",
      durationMs: 0,
      routeName: "",
      error: "INVALID_INSTANCE_ID"
    });
  }

  // 2. Production fail-closed check on internal routing secret
  const isProd = process.env.NODE_ENV === "production";
  const routingSecret = process.env.MYBAY_INTERNAL_ROUTING_SECRET;
  if (!routingSecret && isProd && !isLocal) {
    return Promise.resolve({
      ok: false,
      statusCode: 500,
      headers: {},
      rawBody: "INTERNAL_ROUTING_SECRET_MISSING",
      durationMs: Date.now() - startTime,
      routeName,
      error: "INTERNAL_ROUTING_SECRET_MISSING"
    });
  }

  // 3. Resolve either the private local container target or the Traefik route.
  let protocol: "http:" | "https:";
  let targetHostname: string;
  let targetPort: number;
  let urlPathname = "";
  if (isLocal) {
    try {
      const target = await resolveLocalInstanceTarget(instanceId);
      protocol = target.protocol;
      targetHostname = target.hostname;
      targetPort = target.port;
    } catch {
      return {
        ok: false,
        statusCode: 503,
        headers: {},
        rawBody: "LOCAL_INSTANCE_NETWORK_UNAVAILABLE",
        durationMs: Date.now() - startTime,
        routeName,
        error: "INTERNAL_ROUTE_CONNECT_FAILED"
      };
    }
  } else {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(process.env.TRAEFIK_INTERNAL_URL || "http://traefik/");
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("invalid protocol");
    } catch {
      return {
        ok: false,
        statusCode: 500,
        headers: {},
        rawBody: "INVALID_TRAEFIK_INTERNAL_URL",
        durationMs: Date.now() - startTime,
        routeName,
        error: "INVALID_TRAEFIK_INTERNAL_URL"
      };
    }
    protocol = parsedUrl.protocol;
    targetHostname = parsedUrl.hostname;
    targetPort = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (protocol === "https:" ? 443 : 80);
    urlPathname = parsedUrl.pathname.replace(/\/$/, "");
  }
  const client = protocol === "https:" ? https : http;
  // Safely combine subpath
  const cleanSubPath = path.replace(/^\//, "");
  const resolvedPath = `${urlPathname}/${cleanSubPath}`;

  // 4. Construct request headers
  const reqHeaders: Record<string, string> = {
    "Host": isLocal ? "localhost" : routeName,
  };

  if (routingSecret) {
    reqHeaders["X-MyBay-Internal-Routing"] = routingSecret;
  }

  if (apiKey) {
    reqHeaders["Authorization"] = `Bearer ${apiKey}`;
  }

  if (hermesSessionId && validateHermesSessionId(hermesSessionId)) {
    reqHeaders["X-Hermes-Session-Id"] = hermesSessionId;
  }

  if (options.headers) {
    Object.assign(reqHeaders, options.headers);
  }

  let bodyStr = "";
  if (body !== undefined && body !== null) {
    let finalBody = body;
    if (typeof body === "object" && body !== null) {
      finalBody = { ...body };
      delete finalBody.sessionId;
      delete finalBody.hermesSessionId;
    }
    bodyStr = typeof finalBody === "string" ? finalBody : JSON.stringify(finalBody);
    reqHeaders["Content-Type"] = "application/json";
    reqHeaders["Content-Length"] = String(Buffer.byteLength(bodyStr));
  }

  const reqOptions: http.RequestOptions = {
    method: method.toUpperCase(),
    hostname: targetHostname,
    port: targetPort,
    path: resolvedPath,
    headers: reqHeaders,
    timeout: timeoutMs,
  };

  return new Promise((resolve) => {
    let resolved = false;

    const safeResolve = (result: TraefikRequestResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const req = client.request(reqOptions, (res) => {
      const statusCode = res.statusCode || 0;

      // 5. Redirect Prevention (Fail Closed, do not follow)
      if (statusCode >= 300 && statusCode < 400) {
        res.resume(); // Discard stream
        safeResolve({
          ok: false,
          statusCode,
          headers: res.headers,
          rawBody: "INTERNAL_REDIRECT_REJECTED",
          durationMs: Date.now() - startTime,
          routeName,
          error: "INTERNAL_REDIRECT_REJECTED"
        });
        return;
      }

      // 6. Response Size Limit Check
      const limit = maxResponseBytes || 2 * 1024 * 1024; // Default 2MB limit
      let responseSize = 0;
      const chunks: Buffer[] = [];
      let limitExceeded = false;

      res.on("data", (chunk: Buffer) => {
        if (limitExceeded) return;
        responseSize += chunk.length;
        if (responseSize > limit) {
          limitExceeded = true;
          res.destroy();
          req.destroy();
          safeResolve({
            ok: false,
            statusCode: 413,
            headers: res.headers,
            rawBody: "INTERNAL_RESPONSE_TOO_LARGE",
            durationMs: Date.now() - startTime,
            routeName,
            error: "INTERNAL_RESPONSE_TOO_LARGE"
          });
        } else {
          chunks.push(chunk);
        }
      });

      res.on("end", () => {
        if (limitExceeded) return;

        const rawBody = Buffer.concat(chunks).toString("utf8");
        const ok = statusCode >= 200 && statusCode < 300;

        let json: any = undefined;
        const contentType = res.headers["content-type"] || "";
        if (contentType.includes("application/json") || rawBody.trim().startsWith("{")) {
          try {
            json = JSON.parse(rawBody);
          } catch (e) {
            // Ignore parse error, leave json as undefined
          }
        }

        safeResolve({
          ok,
          statusCode,
          headers: res.headers,
          rawBody,
          json,
          durationMs: Date.now() - startTime,
          routeName
        });
      });

      res.on("error", (err: any) => {
        const standardErrors = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "INTERNAL_ROUTE_CONNECT_FAILED"];
        const errorCode = standardErrors.includes(err.code) ? err.code : "RESPONSE_ERROR";
        safeResolve({
          ok: false,
          statusCode: 0,
          headers: res.headers || {},
          rawBody: errorCode,
          durationMs: Date.now() - startTime,
          routeName,
          error: errorCode
        });
      });
    });

    req.on("timeout", () => {
      req.destroy();
      safeResolve({
        ok: false,
        statusCode: 0,
        headers: {},
        rawBody: "ETIMEDOUT",
        durationMs: Date.now() - startTime,
        routeName,
        error: "ETIMEDOUT"
      });
    });

    req.on("error", (err: any) => {
      const standardErrors = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "INTERNAL_ROUTE_CONNECT_FAILED"];
      const errorCode = standardErrors.includes(err.code) ? err.code : "INTERNAL_ROUTE_CONNECT_FAILED";
      safeResolve({
        ok: false,
        statusCode: 0,
        headers: {},
        rawBody: errorCode,
        durationMs: Date.now() - startTime,
        routeName,
        error: errorCode
      });
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}
