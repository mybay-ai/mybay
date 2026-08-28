import type { NextFunction, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { AuthenticatedRequest } from "../../../middlewares/auth";

export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const createInstanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req: AuthenticatedRequest) => {
    if (req.user?.id) return `instance-create:user:${req.user.id}`;
    return `instance-create:ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { error: "创建实例频率过高，每小时仅允许创建 3 次。" },
});

export const checkLimitOrSkipAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user?.role === "admin") return next();
  createInstanceLimiter(req, res, next);
};
