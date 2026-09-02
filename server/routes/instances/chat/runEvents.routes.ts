import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { getEventsFromCache, requestRunsAPI, runsEventsEmitter } from "../../../services/runsReconciler";
import { isValidInstanceId, isValidUUID } from "./validators";
import { resolveInstanceAuthority, resolveInstanceRunAuthority } from "../../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../../services/instances/resourceAuthorityHttp";

type FlushableResponse = Response & { flush?: () => void };

export function writeAndFlushSse(res: Response, payload: string): void {
  res.write(payload);
  (res as FlushableResponse).flush?.();
}

export function registerRunEventRoutes(router: Router) {


  // ======================================================================
  // 12f. Run Event Stream (SSE)
  // ======================================================================
  const activeUserConnections = new Map<string, number>();
  const MAX_CONCURRENT_SSE_PER_USER = 5;
  const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

  router.post("/:id/runs/:runId/approval", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, runId } = req.params;
    const rawChoice = String(req.body?.choice || "").trim().toLowerCase();
    const choiceAliases: Record<string, string> = { approve: "once", approved: "once", allow: "once", reject: "deny", denied: "deny" };
    const choice = choiceAliases[rawChoice] || rawChoice;
    const allowedChoices = new Set(["once", "session", "always", "deny"]);

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }
    if (!runId || !isValidUUID(runId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "任务 ID 格式错误。" });
    }
    if (!allowedChoices.has(choice)) {
      return res.status(400).json({ success: false, error: "INVALID_APPROVAL_CHOICE", message: "审批选择无效。" });
    }

    try {
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const runAuthority = await resolveInstanceRunAuthority({ instance: instanceAuthority, runId });
      if (runAuthority.ok === false) return sendAuthorityFailure(res, runAuthority, "未找到目标任务或无权访问。");
      const run = runAuthority.run;
      if (!run.upstream_run_id) {
        return res.status(409).json({ success: false, error: "RUN_NOT_DISPATCHED", message: "任务尚未分配到 Agent，请稍后再试。" });
      }

      const approvalResult = await requestRunsAPI({
        instanceId: id,
        method: "POST",
        path: `/v1/runs/${run.upstream_run_id}/approval`,
        body: {
          choice,
          resolve_all: req.body?.resolveAll === true || req.body?.all === true
        },
        timeoutMs: 10000
      }, run);

      if (!approvalResult.ok) {
        return res.status(approvalResult.statusCode || 502).json({
          success: false,
          error: approvalResult.error || "RUN_APPROVAL_FAILED",
          message: "审批指令提交失败，请重试。"
        });
      }

      return res.json({ success: true, status: "submitted", result: approvalResult.json || null });
    } catch (err: any) {
      console.error("[Run Approval Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "审批指令提交失败，请重试。" });
    }
  });
  router.get("/:id/runs/:runId/events", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, runId } = req.params;
    const lastEventIdStr = req.headers['last-event-id'] || req.query.last_event_id;
    const lastEventId = lastEventIdStr ? parseInt(String(lastEventIdStr), 10) : 0;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    if (!runId || !isValidUUID(runId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "任务 ID 格式错误。" });
    }

    const userIdStr = req.user.id.toString();
    const currentConns = activeUserConnections.get(userIdStr) || 0;
    if (currentConns >= MAX_CONCURRENT_SSE_PER_USER) {
      return res.status(429).json({ success: false, error: "TOO_MANY_CONNECTIONS", message: "您的并发连接数过多，请稍后再试。" });
    }

    activeUserConnections.set(userIdStr, currentConns + 1);

    let cleanedUp = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      runsEventsEmitter.off(`event:${runId}`, handler);
      const conns = activeUserConnections.get(userIdStr) || 0;
      if (conns > 1) {
        activeUserConnections.set(userIdStr, conns - 1);
      } else {
        activeUserConnections.delete(userIdStr);
      }
    };

    let terminalSent = false;

    const handler = (evt: { id: number; event: string; data: string }) => {
      if (terminalSent) return;

      writeAndFlushSse(res, `id: ${evt.id}\nevent: ${evt.event}\ndata: ${evt.data}\n\n`);

      if (evt.event === 'status') {
        try {
          const parsed = JSON.parse(evt.data);
          if (['completed', 'failed', 'cancelled', 'stopped', 'expired'].includes(parsed.status)) {
            terminalSent = true;
            res.end();
            cleanup();
          }
        } catch (e) {}
      }
    };

    try {
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) {
        cleanup();
        return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      }
      const runAuthority = await resolveInstanceRunAuthority({ instance: instanceAuthority, runId });
      if (runAuthority.ok === false) {
        cleanup();
        return sendAuthorityFailure(res, runAuthority, "未找到目标任务或无权访问。");
      }
      const run = runAuthority.run;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      res.flushHeaders();
      writeAndFlushSse(res, `: ok\n\n`);
      heartbeatTimer = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          writeAndFlushSse(res, `: ping\n\n`);
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      if (!isNaN(lastEventId)) {
        const { events: cachedEvts, recoveryOutOfBounds } = getEventsFromCache(runId, lastEventId);
        if (recoveryOutOfBounds) {
          writeAndFlushSse(res, `event: error\ndata: ${JSON.stringify({ errorCode: "RECOVERY_OUT_OF_BOUNDS" })}\n\n`);
          res.end();
          cleanup();
          return;
        }
        for (const evt of cachedEvts) {
          writeAndFlushSse(res, `id: ${evt.id}\nevent: ${evt.event}\ndata: ${evt.data}\n\n`);
          if (evt.event === 'status') {
            try {
              const parsed = JSON.parse(evt.data);
              if (['completed', 'failed', 'cancelled', 'stopped', 'expired'].includes(parsed.status)) {
                terminalSent = true;
              }
            } catch (e) {}
          }
        }
      }

      if (!terminalSent && ['completed', 'failed', 'cancelled', 'stopped', 'expired'].includes(run.status)) {
        writeAndFlushSse(res, `event: status\ndata: ${JSON.stringify({ status: run.status })}\n\n`);
        terminalSent = true;
      }

      if (terminalSent) {
        res.end();
        cleanup();
        return;
      }

      runsEventsEmitter.on(`event:${runId}`, handler);

      req.on('close', () => {
        cleanup();
      });

    } catch (err: any) {
      console.error("[Get Chat Run Events SSE Error]", err);
      cleanup();
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.end();
      }
    }
  });

}
