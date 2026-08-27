import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middlewares/auth";
import type { AuthorityActor, AuthorityFailure } from "./resourceAuthorityService";

export function authorityActorFromRequest(req: AuthenticatedRequest): AuthorityActor | null {
  return req.user?.id ? { kind: "user", id: String(req.user.id) } : null;
}

export function sendAuthorityFailure(res: Response, failure: AuthorityFailure, message?: string) {
  return res.status(failure.status).json({
    success: false,
    error: failure.code,
    ...(message ? { message } : {}),
  });
}
