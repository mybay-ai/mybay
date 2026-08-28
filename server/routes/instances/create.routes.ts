import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { authenticateToken } from "../../middlewares/auth";
import type { RouterDependencies } from "./index";
import { checkLimitOrSkipAdmin } from "./create/createRequestPolicy";
import { createInstanceHandler } from "./createInstance.handler";

const createAttemptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `instance-create-attempt:ip:${ipKeyGenerator(req.ip)}`,
  message: { error: "创建实例请求过于频繁，请稍后重试。" },
});

export { createInstanceLimiter, checkLimitOrSkipAdmin } from "./create/createRequestPolicy";

export function createCreateRoutes(deps: RouterDependencies) {
  const router = Router();
  router.post("/", createAttemptLimiter, authenticateToken, checkLimitOrSkipAdmin, createInstanceHandler(deps));
  return router;
}
