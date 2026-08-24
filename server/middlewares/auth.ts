import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { dbAdapter } from "../db";
import { JWT_SECRET } from "../utils/authSecrets";
import { getPublicAppUrl } from "../utils/publicUrl";

export interface AuthenticatedRequest extends Request {
  user?: any;
  token?: string;
  authSource?: "bearer" | "cookie";
}

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admin role required." });
  }
};

export function trustedApplicationOrigin(): string {
  try {
    return new URL(getPublicAppUrl()).origin;
  } catch {
    return "";
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function effectivePort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "";
}

function areEquivalentLoopbackOrigins(origin: URL, trusted: URL): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizedHostname(origin))
    && LOOPBACK_HOSTNAMES.has(normalizedHostname(trusted))
    && origin.protocol === trusted.protocol
    && effectivePort(origin) === effectivePort(trusted);
}

export function isCookieMutationOriginAllowed(input: {
  method: string;
  authSource: "bearer" | "cookie";
  origin?: string;
  trustedOrigin: string;
}): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(input.method.toUpperCase())) return true;
  if (input.authSource === "bearer") return true;
  if (!input.origin || !input.trustedOrigin) return false;
  try {
    const origin = new URL(input.origin);
    const trusted = new URL(input.trustedOrigin);
    return origin.origin === trusted.origin || areEquivalentLoopbackOrigins(origin, trusted);
  } catch {
    return false;
  }
}

function enforceCookieMutationOrigin(req: AuthenticatedRequest, res: Response): boolean {
  const allowed = isCookieMutationOriginAllowed({
    method: req.method,
    authSource: req.authSource || "cookie",
    origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
    trustedOrigin: trustedApplicationOrigin(),
  });
  if (allowed) return true;
  res.status(403).json({ error: "Forbidden", code: "CSRF_ORIGIN_MISMATCH" });
  return false;
}

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  let token = authHeader && authHeader.split(" ")[1];
  
  if (token) {
    const trimmed = token.trim();
    if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
      token = undefined;
    }
  }
  if (token) req.authSource = "bearer";
  
  // Fallback to cookie if token is not found in the Authorization header
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|; )mybay_auth_token=([^;]*)/);
    if (match) {
      const candidate = match[1].trim();
      if (candidate !== "" && candidate !== "null" && candidate !== "undefined") {
        token = candidate;
        req.authSource = "cookie";
      }
    }
  }
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!enforceCookieMutationOrigin(req, res)) return;
  jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
    if (err) {
      console.warn(`[Auth] JWT Verification failed: ${err.message}`);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const user = await dbAdapter.getUserById(decoded.id);
      if (!user) {
        console.warn(`[Auth] User decoded from token not found in database: id=${decoded.id}`);
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      if (user.status === 'disabled') {
        console.warn(`[Auth] Disabled user tried to authenticate: ${user.username}`);
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      req.user = user;
      req.token = token;
      next();
    } catch (e) {
      console.error("[Auth] Database or internal error during authenticateToken:", e);
      res.status(500).json({ error: "Authentication server error" });
    }
  });
};
