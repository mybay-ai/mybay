import { Router } from "express";
import type { RouterDependencies } from "./index";
import { createConfigImportRoutes } from "./configImport.routes";
import { createConfigExportRoutes } from "./configExport.routes";

export function createConfigArchiveRoutes(deps: RouterDependencies) {
  const router = Router();
  router.use(createConfigImportRoutes(deps));
  router.use(createConfigExportRoutes(deps));
  return router;
}
