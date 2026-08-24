import { NextFunction, Router, Response } from "express";
import * as crypto from "crypto";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { dbAdapter } from "../../../db";
import { chatRepo } from "../../../repositories/chatRepo";
import { probeCapabilities, probeCapabilitiesDetailed } from "../../../utils/capabilities";
import { emitRunLifecycleStep, requestRunsAPI, requestRunsReconcile } from "../../../services/runsReconciler";
import { emitChatConversationUpdated } from "../../../services/chatRealtime";
import { runsLimiter } from "./limiters";
import { isValidInstanceId, isValidUUID } from "./validators";
import { buildChatAttachmentMetadata, loadAndValidateChatAttachments } from "../../../utils/chatAttachments";
import { guardManagedOperation } from "../../../utils/managedOperationGuard";
import { isInteractiveRunsEnabled, resolveInteractiveRunsAvailability } from "../../../utils/interactiveRuns";
import { chatUserMessageLimitMessage, isChatUserMessageTooLong } from "../../../../shared/chatMessageContract";
import { normalizeReasoningEffort } from "./helpers";

export function requireInteractiveRunsEnabled(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isInteractiveRunsEnabled()) {
    return res.status(403).json({
      success: false,
      error: "FEATURE_DISABLED",
      reason: "INTERACTIVE_RUNS_DISABLED",
      message: "异步对话任务执行功能当前未启用。"
    });
  }
  next();
}

export function registerRunRoutes(router: Router) {


  // ======================================================================
  // 12b. Check Async Runs Capabilities
  // ======================================================================
  router.get("/:id/runs-capabilities", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const capabilities = await probeCapabilitiesDetailed(instance);
      const availability = resolveInteractiveRunsAvailability(capabilities.state);

      return res.json({
        success: true,
        state: availability.effectiveState,
        upstreamState: availability.upstreamState,
        creationEnabled: availability.creationEnabled,
        effectiveState: availability.effectiveState,
        runsSupported: availability.runsSupported,
        reason: availability.reason,
        toolProgressEvents: capabilities.toolProgressEvents,
        features: capabilities.features,
        endpoints: capabilities.endpoints || {},
        runEventsSse: capabilities.features.run_events_sse === true,
        runStop: capabilities.features.run_stop === true,
        approvalEvents: capabilities.features.approval_events === true,
        runApprovalResponse: capabilities.features.run_approval_response === true,
        sessionResources: capabilities.features.session_resources === true
      });
    } catch (err: any) {
      console.error("[Get Runs Capabilities Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "获取实例服务支持度失败。" });
    }
  });

  // ======================================================================
  // 12c. Create Asynchronous Run
  // ======================================================================
  router.post("/:id/runs", authenticateToken, runsLimiter, requireInteractiveRunsEnabled, async (req: AuthenticatedRequest, res: Response) => {

    const { id } = req.params;
    const { conversationId, content, requestId, reasoningEffort, attachmentIds } = req.body;
    const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    if (!conversationId || !isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "会话 ID 格式错误。" });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "消息内容不可为空。" });
    }

    if (isChatUserMessageTooLong(content)) {
      return res.status(413).json({
        success: false,
        error: "MESSAGE_TOO_LONG",
        message: chatUserMessageLimitMessage()
      });
    }


    if (!requestId || typeof requestId !== "string" || requestId.trim().length === 0) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "缺少 Request ID。" });
    }

    const managedGuard = guardManagedOperation(content);
    if (managedGuard.blocked) {
      return res.status(422).json({
        success: false,
        error: managedGuard.code,
        message: managedGuard.message,
        reason: managedGuard.reason
      });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      let validatedFiles: any[] = [];
      try {
        validatedFiles = await loadAndValidateChatAttachments({
          attachmentIds,
          userId: req.user.id,
          instanceId: id,
          conversationId
        });
      } catch (attachmentErr: any) {
        return res.status(attachmentErr.status || 400).json({
          success: false,
          error: attachmentErr.error || "INVALID_ATTACHMENT",
          message: attachmentErr.message || "Invalid attachment."
        });
      }
      const config = instance.config_json ? JSON.parse(instance.config_json) : {};
      if (config.modelBillingMode === "platform") {
        return res.status(400).json({
          success: false,
          error: "PLATFORM_MODELS_DISABLED",
          message: "Platform-hosted models are not included in the local open-source edition. Use BYOK credentials instead."
        });
      }

      const cap = await probeCapabilities(instance);
      if (cap === 'explicitly_unsupported') {
        return res.status(422).json({
          success: false,
          error: "RUNS_NOT_SUPPORTED",
          message: "该实例不支持异步任务执行。"
        });
      } else if (cap === 'unavailable') {
        return res.status(503).json({
          success: false,
          error: "UPSTREAM_UNAVAILABLE",
          message: "Agent 实例网络异常，请稍后再试。"
        });
      }

      const runId = crypto.randomUUID();

      const beginResult = await chatRepo.beginChatRun({
        conversationId,
        userId: req.user.id,
        instanceId: id,
        content: content.trim(),
        requestId: requestId.trim(),
        runId,
        reasoningEffort: normalizedReasoningEffort
      });


      if (beginResult.status === 'IDEMPOTENT_REPLAY' && beginResult.run_id) {
        if (["queued", "running", "stopping"].includes(String(beginResult.run_status))) {
          requestRunsReconcile();
        }
        return res.status(200).json({
          success: true,
          replayed: true,
          runId: beginResult.run_id,
          status: beginResult.run_status || "queued",
          userMessageId: beginResult.user_message_id,
          sequenceNo: beginResult.sequence_no
        });
      } else if (beginResult.status === 'DUPLICATE_REQUEST_ID') {
        return res.status(409).json({ success: false, error: "DUPLICATE_REQUEST_ID", message: "重复的请求 Request ID，该请求已被处理。" });
      } else if (beginResult.status === 'CONCURRENT_RUN') {
        return res.status(429).json({ success: false, error: "TOO_MANY_CONCURRENT_RUNS", message: "当前实例存在正在运行的异步对话任务，请稍候再试。" });
      } else if (beginResult.status === 'DUPLICATE_RUN') {
        return res.status(409).json({ success: false, error: "DUPLICATE_RUN", message: "重复的 Run ID，该任务已被处理。" });
      } else if (beginResult.status !== 'success' || !beginResult.user_message_id) {
        console.error(JSON.stringify({
          operation: "chat_run_begin_failed",
          instanceId: id,
          conversationId,
          requestId,
          status: beginResult.status
        }));
        return res.status(500).json({ success: false, error: "BEGIN_RUN_FAILED", message: "初始化异步任务失败。" });
      }

      if (validatedFiles.length > 0) {
        try {
          await chatRepo.updateChatMessageMetadata(beginResult.user_message_id, buildChatAttachmentMetadata(validatedFiles));
        } catch (metadataErr: any) {
          await chatRepo.finishChatRun({
            runId,
            status: "failed",
            errorCode: "ATTACHMENT_METADATA_UPDATE_FAILED"
          }).catch(() => {});
          return res.status(500).json({
            success: false,
            error: "ATTACHMENT_METADATA_UPDATE_FAILED",
            message: "Failed to attach files to this Agent run. Please retry."
          });
        }
      }

      emitChatConversationUpdated({
        userId: req.user.id,
        instanceId: id,
        conversationId,
        requestId: requestId.trim(),
        runId,
        source: "run_created",
        status: "queued"
      });

      emitRunLifecycleStep(
        runId,
        "task_queued",
        "Agent task queued",
        "running",
        "model_reasoning",
        undefined,
        { conversationId }
      );

      // Keep the periodic scan as crash recovery, but dispatch interactive work now.
      requestRunsReconcile();

      return res.status(202).json({
        success: true,
        runId,
        status: "queued",
        userMessageId: beginResult.user_message_id,
        sequenceNo: beginResult.sequence_no
      });

    } catch (err: any) {
      console.error(JSON.stringify({
        operation: "create_chat_run_exception",
        instanceId: id,
        conversationId,
        requestId,
        message: err?.message || "Unknown Error",
        code: err?.code || null
      }));
      if (process.env.NODE_ENV !== "production" || process.env.MYBAY_DEBUG_ERRORS === "true") {
        console.error(JSON.stringify({
          operation: "create_chat_run_exception_debug",
          instanceId: id,
          conversationId,
          requestId,
          stack: err?.stack || null
        }));
      }
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "创建异步任务失败，请重试。" });
    }
  });

  // ======================================================================
  // 12d. Get Chat Run Status
  // ======================================================================
  router.get("/:id/runs/:runId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, runId } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    if (!runId || !isValidUUID(runId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "任务 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const run = await chatRepo.getChatRun(runId);
      if (!run || run.instance_id !== id || run.user_id !== req.user.id) {
        return res.status(404).json({ success: false, error: "RUN_NOT_FOUND", message: "未找到目标任务或无权访问。" });
      }

      return res.json({
        success: true,
        run: {
          id: run.id,
          status: run.status,
          partialOutput: run.partial_output,
          errorCode: run.error_code,
          durationMs: run.duration_ms,
          usagePromptTokens: run.usage_prompt_tokens,
          usageCompletionTokens: run.usage_completion_tokens,
          usageTotalTokens: run.usage_total_tokens,
          createdAt: run.created_at,
          started_at: run.started_at,
          completed_at: run.completed_at
        }
      });
    } catch (err: any) {
      console.error("[Get Chat Run Status Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "获取任务状态失败。" });
    }
  });

  // ======================================================================
  // 12e. Stop Chat Run
  // ======================================================================
  router.post("/:id/runs/:runId/stop", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, runId } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    if (!runId || !isValidUUID(runId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "任务 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const run = await chatRepo.getChatRun(runId);
      if (!run || run.instance_id !== id || run.user_id !== req.user.id) {
        return res.status(404).json({ success: false, error: "RUN_NOT_FOUND", message: "未找到目标任务或无权访问。" });
      }

      const stopResult = await chatRepo.requestStopChatRun({
        runId,
        userId: req.user.id,
        instanceId: id
      });

      if (stopResult.status === 'stop_requested') {
        return res.json({
          success: true,
          status: "stopping",
          message: "中止请求已发送。"
        });
      } else if (stopResult.status === 'already_stopping') {
        return res.json({
          success: true,
          status: "stopping",
          message: "中止请求已发送。"
        });
      } else if (stopResult.status === 'already_terminal') {
        return res.json({
          success: true,
          status: stopResult.run_status,
          message: "任务已处于结束状态。"
        });
      } else if (stopResult.status === 'NOT_FOUND_OR_FORBIDDEN') {
        return res.status(404).json({
          success: false,
          error: "RUN_NOT_FOUND",
          message: "未找到目标任务或无权访问。"
        });
      } else if (stopResult.status === 'invalid_state') {
        return res.status(409).json({
          success: false,
          error: "INVALID_STATE",
          message: `无法中止处于 ${stopResult.run_status} 状态的任务。`
        });
      } else {
        return res.status(500).json({
          success: false,
          error: "INTERNAL_ERROR",
          message: "中止任务失败，请重试。"
        });
      }
    } catch (err: any) {
      console.error("[Stop Chat Run Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "中止任务失败，请重试。" });
    }
  });

  // ======================================================================

}


