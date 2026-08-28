import { Router } from "express";
import { authenticateToken } from "../../middlewares/auth";
import type { RouterDependencies } from "./index";
import { checkLimitOrSkipAdmin } from "./create/createRequestPolicy";
import { createInstanceHandler } from "./createInstance.handler";

export { createInstanceLimiter, checkLimitOrSkipAdmin } from "./create/createRequestPolicy";

export function createCreateRoutes(deps: RouterDependencies) {
  const router = Router();
  router.post("/", authenticateToken, checkLimitOrSkipAdmin, createInstanceHandler(deps));
  return router;
}
