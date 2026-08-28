import { Router, Response } from "express";
import { dbAdapter } from "../../db";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { getDeploymentModeConfig, saveDeploymentModeConfig } from "../../services/deploymentMode";

export function createDeploymentModeRoutes() {
  const router = Router();

  router.get("/deployment-mode", authenticateToken, async (_req: AuthenticatedRequest, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await getDeploymentModeConfig());
  });

  router.post("/deployment-mode", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "ADMIN_REQUIRED" });
    try {
      const config = await saveDeploymentModeConfig(req.body?.mode, req.body?.lanIp);
      res.json(config);
    } catch (error: any) {
      res.status(400).json({ error: error?.code || "DEPLOYMENT_MODE_INVALID" });
    }
  });

  router.get("/first-run", authenticateToken, async (_req: AuthenticatedRequest, res: Response) => {
    const completed = await dbAdapter.getSystemSettingBoolean("first_run_completed", false);
    res.setHeader("Cache-Control", "no-store");
    res.json({ completed, required: !completed });
  });

  router.post("/first-run/complete", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "ADMIN_REQUIRED" });
    await dbAdapter.setSystemSettingBoolean("first_run_completed", true);
    res.json({ success: true, completed: true });
  });

  return router;
}
