import { Router, type Response } from "express";
import { dbAdapter } from "../../db";
import { authenticateToken, type AuthenticatedRequest } from "../../middlewares/auth";
import { chatRepo } from "../../repositories/chatRepo";
import { requestRunsAPI } from "../../services/runsReconciler";
import { runHermesManualCompaction } from "../../services/hermesManualCompaction";
import type { RouterDependencies } from "./index";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_.:-]{8,160}$/;

function canManageInstance(req: AuthenticatedRequest, instance: any) {
  return instance.user_id === req.user.id || req.user.role === "admin" || req.user.role === "super_admin";
}

function runtimeType(instance: any): "pi" | "hermes" {
  let config: any = {};
  try { config = JSON.parse(instance.config_json || "{}"); } catch { /* default to Hermes */ }
  return String(instance.runtime_type || config.runtime_type || "hermes").trim().toLowerCase() === "pi" ? "pi" : "hermes";
}

function safeMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createContextCompactionRoutes(deps: RouterDependencies) {
  const router = Router();

  router.post("/:id/conversations/:conversationId/compact", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;
    if (!UUID_PATTERN.test(id || "") || !UUID_PATTERN.test(conversationId || "")) return res.status(400).json({ code: "INVALID_RESOURCE_ID", error: "INVALID_RESOURCE_ID" });
    try {
      const instance: any = await dbAdapter.getInstanceById(id);
      if (!instance) return res.status(404).json({ code: "INSTANCE_NOT_FOUND", error: "Instance not found" });
      if (!canManageInstance(req, instance)) return res.status(403).json({ code: "FORBIDDEN", error: "Forbidden" });
      const conversation = await chatRepo.getConversationForOwnerAndInstance(instance.user_id, id, conversationId);
      if (!conversation) return res.status(404).json({ code: "CONVERSATION_NOT_FOUND", error: "CONVERSATION_NOT_FOUND" });
      const activeRun = await chatRepo.getActiveRunForConversation(instance.user_id, id, conversationId);
      if (activeRun) return res.status(409).json({ code: "CONVERSATION_BUSY", error: "CONVERSATION_BUSY" });
      const sessionId = String(conversation.session_id || "").trim();
      if (!SESSION_ID_PATTERN.test(sessionId)) return res.status(409).json({ code: "SESSION_NOT_READY", error: "SESSION_NOT_READY" });

      let result: any;
      const runtime = runtimeType(instance);
      if (runtime === "pi") {
        const upstream = await requestRunsAPI({
          instanceId: id,
          method: "POST",
          path: `/v1/sessions/${encodeURIComponent(sessionId)}/compact`,
          body: {},
          timeoutMs: 150_000,
        }, instance);
        const upstreamResult = upstream.json && typeof upstream.json === "object" ? upstream.json : null;
        if (!upstream.ok && !upstreamResult?.status) {
          return res.status(upstream.statusCode || 502).json({ code: "PI_COMPACTION_FAILED", error: upstreamResult?.error || upstream.error || "PI_COMPACTION_FAILED" });
        }
        result = {
          runtime,
          status: upstreamResult?.status === "completed" ? "completed" : upstreamResult?.status === "aborted" ? "aborted" : "failed",
          reason: "manual",
          previousSessionId: sessionId,
          sessionId,
          tokensBefore: safeMetric(upstreamResult?.tokensBefore),
          estimatedTokensAfter: safeMetric(upstreamResult?.estimatedTokensAfter),
          ...(upstreamResult?.error ? { error: String(upstreamResult.error).slice(0, 240) } : {}),
        };
      } else {
        result = await runHermesManualCompaction({ dockerClient: deps.docker, instanceId: id, sessionId });
        if (result.status === "completed" && result.sessionId !== sessionId) {
          await chatRepo.bindConversationSessionId(conversationId, result.sessionId);
        }
      }

      await dbAdapter.insertAuditLog({
        instance_id: id,
        action: "compact_agent_context",
        user_id: req.user.id,
        timestamp: new Date().toISOString(),
        details: JSON.stringify({
          runtime: result.runtime,
          status: result.status,
          conversationId,
          previousSessionId: result.previousSessionId,
          sessionId: result.sessionId,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
        }),
      }).catch((auditError) => console.warn("Context compaction audit log failed:", auditError));

      return res.status(result.status === "completed" ? 200 : 409).json(result);
    } catch (error: any) {
      console.error("Context compaction failed:", error);
      return res.status(Number(error?.statusCode || 500)).json({ code: "CONTEXT_COMPACTION_FAILED", error: String(error?.message || "CONTEXT_COMPACTION_FAILED").slice(0, 240) });
    }
  });

  return router;
}
