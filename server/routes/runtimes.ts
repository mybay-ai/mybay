import { Router } from "express";
import { runtimeRegistry } from "../runtime/runtimeRegistry";

const router = Router();

export function buildRuntimeCatalogResponse() {
  return {
    schemaVersion: 1 as const,
    runtimes: runtimeRegistry.listRuntimeDefinitions(),
  };
}

router.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(buildRuntimeCatalogResponse());
});

export default router;
