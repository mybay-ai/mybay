import { Router, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import Docker from "dockerode";
import { dbAdapter } from "../../db";
import { authenticateToken, AuthenticatedRequest } from "../../middlewares/auth";
import { parseTraefikEnv } from "../../infrastructure/traefik/traefikConfig";
import { sanitizeInstance } from "../../utils/sanitizer";

import { createListRoutes } from "./list.routes";
import { createCreateRoutes } from "./create.routes";
import { createLifecycleRoutes } from "./lifecycle.routes";
import { createActionsRoutes } from "./actions.routes";
import { createFilesRoutes } from "./files.routes";
import { createConfigRoutes } from "./config.routes";
import { createTemplatesRoutes } from "./templates.routes";
import { createChannelsRoutes } from "./channels.routes";
import { createTelemetryRoutes } from "./telemetry.routes";
import { createVersionsRoutes } from "./versions.routes";
import { createChatRoutes } from "./chat.routes";
import { createChatFilesRoutes } from "./chatFiles.routes";
import { createEventsRoutes } from "./events.routes";
import { createA2ARoutes } from "./a2a.routes";
import templateFilesRouter from "./templateFiles.routes";
import { checkAccessBridgeCompatibility } from "./helpers";

export const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });
export const setupSessionMap = new Map<string, any>();
export const containerStatsCache = new Map<string, { data: any, timestamp: number }>();

export function invalidateContainerStatsCache(instanceId: string) {
  containerStatsCache.delete(instanceId);
}

export interface RouterDependencies {
  io: SocketIOServer;
  wrappedUpdateStatus: { run: (p: {status: string, id: string}) => Promise<any> };
  docker: Docker;
  setupSessionMap: Map<string, any>;
  containerStatsCache: Map<string, { data: any, timestamp: number }>;
}

export function createInstancesRouter(io: SocketIOServer) {
  const router = Router();

  const wrappedUpdateStatus = {
    run: async (params: { status: string; id: string }) => {
      const result = await dbAdapter.updateInstanceStatus(params.id, params.status);
      io.emit("instances_updated", { id: params.id, status: params.status });
      return result;
    }
  };

  const deps: RouterDependencies = { io, wrappedUpdateStatus, docker, setupSessionMap, containerStatsCache };

  router.use("/template-files", templateFilesRouter);
  router.use(createListRoutes(deps));
  router.use(createCreateRoutes(deps));
  router.use(createLifecycleRoutes(deps));
  router.use(createActionsRoutes(deps));
  router.use(createEventsRoutes({ docker }));
  router.use(createA2ARoutes());
  router.use(createFilesRoutes(deps));
  router.use(createConfigRoutes(deps));
  router.use(createTemplatesRoutes(deps));
  router.use(createChannelsRoutes(deps));
  router.use(createTelemetryRoutes(deps));
  router.use(createVersionsRoutes(deps));
  router.use(createChatRoutes(deps));
  router.use(createChatFilesRoutes());

  // The generic /:id route MUST be last to avoid capturing sub-routes like /templates or /can-create
  router.get("/:id", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const instance: any = await dbAdapter.getInstanceById(req.params.id);
      if (!instance) {
        return res.status(404).json({ error: "Instance not found" });
      }
      
      // Strict ownership check: owner, admin, or super_admin only
      const isPrivileged = req.user.role === "admin" || req.user.role === "super_admin";
      if (instance.user_id !== req.user.id && !isPrivileged) {
        return res.status(403).json({ error: "Forbidden: You do not have permission to view this instance" });
      }

      const tEnv = parseTraefikEnv(process.env);
      const sanitized = sanitizeInstance(instance, "detail");
      const accessBridgeCompatibility = await checkAccessBridgeCompatibility(instance).catch(() => ({ required: false, compatible: true }));
      
      res.json({
        ...sanitized,
        proxyMode: tEnv.proxyMode,
        traefikNetwork: tEnv.traefikNetwork,
        accessBridgeCompatibility
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch instance details" });
    }
  });

  return router;
}
