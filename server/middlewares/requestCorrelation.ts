import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestCorrelation: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.get("x-request-id");
  const requestId = typeof incomingRequestId === "string" && REQUEST_ID_PATTERN.test(incomingRequestId)
    ? incomingRequestId
    : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
};
