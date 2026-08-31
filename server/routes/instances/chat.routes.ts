import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../middlewares/auth";
import { dbAdapter } from "../../db";
import rateLimit from "express-rate-limit";
import { getClientIp } from "../../utils/ip";
import { RouterDependencies } from "./index";
import { requestTraefikInternal } from "../../utils/traefikInternalRequest";
import { mapChatError } from "../../utils/chatErrorMapper";


import { chatRepo } from "../../repositories/chatRepo";
import { hasConfiguredInternalApiKey, resolveInstanceInternalApiKey } from "../../utils/instanceInternalApiKey";
import { registerConversationRoutes } from "./chat/conversation.routes";
import { registerRunRoutes } from "./chat/runs.routes";
import { registerRunQuestionRoutes } from "./chat/runQuestions.routes";
import { registerRunEventRoutes } from "./chat/runEvents.routes";
import { registerQuickRoutes } from "./chat/quick.routes";
import { registerAssistRoutes } from "./chat/assist.routes";
import { registerFeedbackRoutes } from "./chat/feedback.routes";
import {
  buildLocalChatReadiness,
  isLocalRuntimeReadyStatus,
  resolveLocalChatLifecycleReadiness,
} from "../../../shared/chatReadinessContract";
import { resolveInstanceAuthority } from "../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../services/instances/resourceAuthorityHttp";
export { runsLimiter, runsLimiterStore, cleanupRunsLimiterStore } from "./chat/limiters";

const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Max 20 requests per minute
  keyGenerator: (req: any) => `chat_workspace:ip:${getClientIp(req)}:user:${req.user?.id || 'anon'}`,
  message: {
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "对话请求过于频繁，每分钟最多发送 20 条消息，请稍后再试。"
  }
});

function getSingleHeader(val: string | string[] | undefined): string | null {
  if (!val) return null;
  return Array.isArray(val) ? val[0] : val;
}

// Memory store for runs rate limiting
export function createChatRoutes(deps: RouterDependencies) {
  const router = Router();
  registerRunQuestionRoutes(router);

  registerConversationRoutes(router);
  registerFeedbackRoutes(router);

  registerQuickRoutes(router);
  registerAssistRoutes(router);

  // 7. Legacy Stateless Chat route (Backward Compatibility Guarantee)
  // ======================================================================
  router.post("/:id/chat", authenticateToken, chatLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const startTime = Date.now();
    let status = "failed";
    let promptLength = 0;
    let messagesCount = 0;

    try {
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const instance = instanceAuthority.instance;
      const isPrivileged = req.user.role === "admin" || req.user.role === "super_admin";

      let config: any = {};
      if (instance.config_json) {
        try {
          config = typeof instance.config_json === "string"
            ? JSON.parse(instance.config_json)
            : instance.config_json;
        } catch (e) {
          config = {};
        }
      }
      const lifecycleReadiness = resolveLocalChatLifecycleReadiness({
        status: instance.status,
        dashboardEnabled: config.enableDashboard,
      });
      if (lifecycleReadiness) {
        return res.status(409).json({
          success: false,
          error: "INSTANCE_NOT_READY",
          message: `实例目前处于 [${instance.status || "未知"}] 状态，请确保其已完全启动并就绪后再进行对话。`
        });
      }

      const { messages, model, temperature, max_tokens } = req.body;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: "INVALID_REQUEST",
          message: "请求体中缺少必要的 messages 数组，或数组为空。"
        });
      }

      const bodyStr = JSON.stringify(req.body);
      if (bodyStr.length > 512 * 1024) {
        return res.status(413).json({
          success: false,
          error: "PAYLOAD_TOO_LARGE",
          message: "请求内容过大（上限 512 KB）。请缩短对话历史或消息长度。"
        });
      }

      promptLength = bodyStr.length;
      messagesCount = messages.length;


      let enabledChannels: string[] = [];
      if (config.channel) {
        if (Array.isArray(config.channel)) {
          enabledChannels = config.channel.map((c: string) => c.toLowerCase());
        } else if (typeof config.channel === 'string') {
          enabledChannels = [config.channel.toLowerCase()];
        }
      }
      const isApiEnabled = enabledChannels.includes("api") || 
                           config.publicApiEnabled === true || 
                           config.exposeApi === true || 
                           config.publicApiEnabled === "true" || 
                           config.exposeApi === "true" ||
                           hasConfiguredInternalApiKey(instance);
      if (!isApiEnabled) {
        return res.status(424).json({
          success: false,
          error: "CHAT_API_NOT_ENABLED",
          message: "该实例未启用内部对话 API 渠道。"
        });
      }

      const requestBody = {
        messages,
        model: model || config.model || config.current_model || config.MODEL || undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        max_tokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 1024) : 1024,
        stream: false
      };

      const keyResolution = resolveInstanceInternalApiKey(instance);
      if (!keyResolution.ok || !keyResolution.apiKey) {
        return res.status(400).json({
          success: false,
          error: keyResolution.error || "HERMES_INTERNAL_API_KEY_MISSING",
          message: keyResolution.error === "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED" ? "Hermes internal API key decrypt failed." : "Instance is missing Hermes internal API key."
        });
      }
      const apiKey = keyResolution.apiKey;
      {
        const response = await requestTraefikInternal({
          instanceId: String(instance.id),
          method: "POST",
          path: "/v1/chat/completions",
          apiKey,
          body: requestBody,
          timeoutMs: 120000,
        });

        if (!response.ok) {
          console.error(`[Stateless Chat Error] Upstream call failed. StatusCode: ${response.statusCode || 502}, Error: ${response.error || "Unknown"}`);
          const mapped = mapChatError(response);
          if (!isPrivileged) {
            delete mapped.diagnostics;
          }
          return res.status(response.statusCode || 502).json(mapped);
        }

        const isJsonValid = response.json !== undefined && 
                           response.json !== null &&
                           Array.isArray(response.json.choices) && 
                           response.json.choices.length > 0 && 
                           response.json.choices[0].message && 
                           typeof response.json.choices[0].message.content === "string";

        if (!isJsonValid) {
          const invalidMapped = mapChatError({ error: "INVALID_HERMES_RESPONSE" });
          if (!isPrivileged) {
            delete invalidMapped.diagnostics;
          }
          return res.status(502).json(invalidMapped);
        }

        status = "success";
        return res.json({
          success: true,
          message: response.json.choices[0].message.content,
          usage: response.json.usage || null,
          sessionId: getSingleHeader(response.headers["x-hermes-session-id"]) || getSingleHeader(response.headers["X-Hermes-Session-Id"]) || null,
          durationMs: response.durationMs
        });
      }
    } catch (routeErr: any) {
      return res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: "后端工作台代理模块执行异常，请联系管理员。"
      });
    } finally {
      try {
        await dbAdapter.insertAuditLog({
          instance_id: id,
          action: "chat_workspace_message",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: JSON.stringify({
            messagesCount,
            promptLength,
            status,
            timestamp: Date.now()
          })
        });
      } catch (e) {}
    }
  });

  // ======================================================================
  // 8. Chat Readiness Check
  // ======================================================================
  router.get("/:id/chat-readiness", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    try {
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const instance = instanceAuthority.instance;

      let config: any = {};
      if (instance.config_json) {
        try {
          config = typeof instance.config_json === "string"
            ? JSON.parse(instance.config_json)
            : instance.config_json;
        } catch (e) {}
      }
      const lifecycleReadiness = resolveLocalChatLifecycleReadiness({
        status: instance.status,
        dashboardEnabled: config.enableDashboard,
      });
      const currentStatus = String(instance.status || "").toLowerCase();
      const runtimeReadyByLifecycle = isLocalRuntimeReadyStatus(currentStatus);
      if (lifecycleReadiness) {
        return res.json({
          success: true,
          ...lifecycleReadiness,
          message: `实例目前处于 [${instance.status || "未知"}] 状态，尚未启动。`
        });
      }


      let enabledChannels: string[] = [];
      if (config.channel) {
        if (Array.isArray(config.channel)) {
          enabledChannels = config.channel.map((c: string) => c.toLowerCase());
        } else if (typeof config.channel === 'string') {
          enabledChannels = [config.channel.toLowerCase()];
        }
      }
      const isApiEnabled = enabledChannels.includes("api") || 
                           config.publicApiEnabled === true || 
                           config.exposeApi === true || 
                           config.publicApiEnabled === "true" || 
                           config.exposeApi === "true" ||
                           hasConfiguredInternalApiKey(instance);

      if (!isApiEnabled) {
        return res.json({
          success: true,
          ...buildLocalChatReadiness({
            ready: false,
            runtimeReady: runtimeReadyByLifecycle,
            sendable: false,
            status: currentStatus,
            reason: "CHAT_API_NOT_ENABLED",
            error: "CHAT_API_NOT_ENABLED",
            message: "该实例正在运行，但未启用内部对话 API 渠道。"
          })
        });
      }

      const keyResolution = resolveInstanceInternalApiKey(instance);
      if (!keyResolution.ok || !keyResolution.apiKey) {
        return res.json({
          success: true,
          ...buildLocalChatReadiness({
            ready: false,
            runtimeReady: runtimeReadyByLifecycle,
            sendable: false,
            status: currentStatus,
            reason: keyResolution.error || "HERMES_INTERNAL_API_KEY_MISSING",
            error: keyResolution.error || "HERMES_INTERNAL_API_KEY_MISSING",
            message: keyResolution.error === "HERMES_INTERNAL_API_KEY_DECRYPT_FAILED" ? "Hermes internal API key decrypt failed." : "Instance is missing Hermes internal API key."
          })
        });
      }
      const apiKey = keyResolution.apiKey;
      const response = await requestTraefikInternal({
        instanceId: id,
        method: "GET",
        path: "/v1/models",
        apiKey,
        timeoutMs: 5000,
      });

      const isJson = response.headers["content-type"]?.includes("application/json") || response.json !== undefined;
      const data = response.json;
      const ready = response.ok && isJson && data && data.object === "list" && Array.isArray(data.data) && data.data.length > 0;

      let error: string | null = null;
      let message = "实例对话 API 已就绪";

      if (!ready) {
        if (response.error === "INTERNAL_ROUTING_SECRET_MISSING") {
          error = "INTERNAL_ROUTING_SECRET_MISSING";
          message = "安全配置还原异常，内部路由不可用。";
        } else if (response.error === "ETIMEDOUT" || response.error === "INTERNAL_ROUTE_TIMEOUT") {
          error = "INTERNAL_ROUTE_TIMEOUT";
          message = "连接实例内部对话 API 路由超时。";
        } else if (response.error === "ECONNREFUSED" || response.statusCode === 0) {
          error = "INTERNAL_ROUTE_CONNECT_FAILED";
          message = "连接实例内部对话 API 路由失败。";
        } else if (response.statusCode === 404) {
          error = "INTERNAL_ROUTE_NOT_FOUND";
          message = "内部网关路由未找到，实例路由可能尚未生效或容器未就绪。";
        } else if (response.statusCode === 401) {
          error = "HERMES_API_AUTH_FAILED";
          message = "实例内部对话 API 密钥认证失败。";
        } else if (response.statusCode === 403) {
          error = "INTERNAL_ROUTE_AUTH_FAILED";
          message = "内部网关路由访问被拒绝。";
        } else if (response.statusCode === 502 || response.statusCode === 503 || response.statusCode === 504) {
          error = "HERMES_API_NOT_READY";
          message = "Agent 对话 API 未就绪或正在启动模型服务。";
        } else {
          error = "INVALID_HERMES_RESPONSE";
          message = "实例 API 返回了非预期的响应格式。";
        }
      }

      return res.json({
        success: true,
        ...buildLocalChatReadiness({
          ready,
          runtimeReady: ready || runtimeReadyByLifecycle,
          sendable: ready,
          status: currentStatus,
          reason: error,
          error,
          message
        })
      });

    } catch (e: any) {
      console.error("[Chat Readiness Error]", e);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "内部探测服务异常，请稍后再试。" });
    }
  });

  registerRunRoutes(router);
  registerRunEventRoutes(router);


  return router;
}


