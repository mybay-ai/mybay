import { Request } from "express";

/**
 * Return the client IP already resolved by Express. Express only consumes
 * forwarded headers when the application has explicitly enabled trust proxy.
 */
export function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "0.0.0.0";
}
