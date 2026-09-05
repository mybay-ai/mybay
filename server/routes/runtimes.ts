import { Router } from "express";
import { runtimeRegistry } from "../runtime/runtimeRegistry";
import { isPiRuntimeBetaEnabled } from "../utils/runtimeReleaseBoundary";

const router = Router();

export function buildRuntimeCatalogResponse(piEnabled = isPiRuntimeBetaEnabled()) {
  return {
    schemaVersion: 1 as const,
    runtimes: runtimeRegistry.listRuntimeDefinitions().map((definition) => definition.runtime.type !== "pi"
      ? definition
      : {
          ...definition,
          release: {
            ...definition.release,
            deploymentSupported: piEnabled && definition.release.deploymentSupported,
          },
        }),
  };
}

router.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(buildRuntimeCatalogResponse());
});

export default router;
