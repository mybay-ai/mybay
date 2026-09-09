import { Router } from "express";
import { runtimeRegistry } from "../runtime/runtimeRegistry";
import { isPiRuntimeBetaEnabled, isCodexRuntimeEnabled } from "../utils/runtimeReleaseBoundary";

const router = Router();

export function buildRuntimeCatalogResponse(piEnabled = isPiRuntimeBetaEnabled(), codexEnabled = isCodexRuntimeEnabled()) {
  return {
    schemaVersion: 1 as const,
    runtimes: runtimeRegistry.listRuntimeDefinitions().map((definition) => definition.runtime.type === "codex" ? { ...definition, release: { ...definition.release, deploymentSupported: codexEnabled && definition.release.deploymentSupported } } : definition.runtime.type !== "pi"
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
