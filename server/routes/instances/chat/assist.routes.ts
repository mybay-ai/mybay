import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { dbAdapter } from "../../../db";
import { chatRepo } from "../../../repositories/chatRepo";
import { buildChatAttachmentMetadata, buildUnsupportedDirectChatMessage, getUnsupportedDirectChatAttachments, loadAndValidateChatAttachments, processAttachmentsForPrompt } from "../../../utils/chatAttachments";
import { generateChatCompletion } from "../../../utils/llmClient";
import { containsDsmlToolCallProtocol, buildDsmlToolCallLeakPayload } from "../../../utils/dsmlToolCallGuard";
import { emitChatConversationUpdated } from "../../../services/chatRealtime";
import { resolveConversationAuthority, resolveInstanceAuthority } from "../../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../../services/instances/resourceAuthorityHttp";
import { canWriteHttpResponse, createSyncChatRequestLifecycle } from "../../../services/syncChatCancellation";
import { buildAssistContext, chatLimiter, extractSafeErrorMessage, isChatTurnRpcSchemaError, isValidInstanceId, isValidUUID, getDefaultMaxTokensForReasoning, getReasoningInstruction, normalizeChatTemperature, normalizeReasoningEffort, resolveQuickChatModelConfig } from "./helpers";
import { CHAT_CONTEXT_MESSAGE_LIMIT, chatUserMessageLimitMessage, isChatUserMessageTooLong, selectRecentMessagesForContext } from "../../../../shared/chatMessageContract";

export function registerAssistRoutes(router: Router) {
  // 6b. Active Conversation Assist Chat (Synchronous Skills Assist Engine)
  // ======================================================================
  router.post("/:id/conversations/:conversationId/assist", authenticateToken, chatLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;
    const { content, requestId, model, temperature, max_tokens, reasoningEffort, skillId, attachmentIds } = req.body;
    const startTime = Date.now();
    const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort);
    console.log(JSON.stringify({
      operation: "chat_workspace_request_received",
      mode: "assist",
      instanceId: id,
      conversationId,
      requestId,
      skillId,
      hasAttachments: Array.isArray(attachmentIds) && attachmentIds.length > 0,
      reasoningEffort: normalizedReasoningEffort
    }));
    let auditStatus = "failed";
    let promptLength = 0;
    let messagesCount = 1;

    let pendingConversationId: string | null = null;
    let pendingUserMessageId: string | null = null;
    let turnFinished = false;
    let phase = "init";


    // Validation for attachmentIds
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

    const unsupportedDirectAttachments = getUnsupportedDirectChatAttachments(validatedFiles);
    if (unsupportedDirectAttachments.length > 0) {
      return res.status(422).json({
        success: false,
        error: "ATTACHMENT_UNSUPPORTED_FOR_DIRECT_CHAT",
        message: buildUnsupportedDirectChatMessage(unsupportedDirectAttachments)
      });
    }
    let attachmentContext = "";
    if (validatedFiles && validatedFiles.length > 0) {
      attachmentContext = await processAttachmentsForPrompt(validatedFiles);
      if (attachmentContext.includes("读取失败")) {
        return res.status(500).json({ success: false, error: "ATTACHMENT_READ_FAILED", message: "附件读取失败，请重新上传后再试。" });
      }
    }

    // 0. Strict input validation
    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }
    if (!isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "会话 ID 格式错误。" });
    }
    if (!isValidUUID(requestId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "请求 ID 格式错误。" });
    }

    const ALLOWED_ASSIST_SKILLS = [
      "model_config_diagnosis",
      "explain_last_error",
      "instance_health_summary",
      "summarize_conversation"
    ];

    if (!skillId || typeof skillId !== "string" || !ALLOWED_ASSIST_SKILLS.includes(skillId)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_ASSIST_SKILL",
        message: "不合法的辅助技能标识符。"
      });
    }

    if (temperature !== undefined && temperature !== null) {
      const tempNum = Number(temperature);
      if (!Number.isFinite(tempNum) || tempNum < 0 || tempNum > 2.0) {
        return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "温度值非法。" });
      }
    }

    if (max_tokens !== undefined && max_tokens !== null) {
      const tokensNum = Number(max_tokens);
      if (!Number.isInteger(tokensNum) || tokensNum <= 0 || tokensNum > 4096) {
        return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "最大 token 数值非法。" });
      }
    }

    const syncLifecycle = createSyncChatRequestLifecycle(req, res);
    const acquireNaturalTerminalOwnership = () => {
      if (syncLifecycle.hasCommitOwnership()) return;
      if (!syncLifecycle.tryAcquireCommit()) syncLifecycle.throwIfCancelled();
    };

    try {
      // 1. Fetch & Verify Instance (Strict owner lock)
      phase = "load_instance";
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const instance = instanceAuthority.instance;

      // 2. Status verification
      const allowedStatuses = ["running", "gateway_ready", "partial_running", "dashboard_ready"];
      const currentStatus = String(instance.status || "").toLowerCase();
      if (!allowedStatuses.includes(currentStatus)) {
        return res.status(409).json({
          success: false,
          error: "INSTANCE_NOT_READY",
          message: `实例目前处于 [${instance.status || "未知"}] 状态，请确保其已完全启动并就绪后再进行对话。`
        });
      }

      // 3. Enforce the shared user-message contract before persisting the turn.
      if (!content || typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "INVALID_REQUEST",
          message: "消息内容不可为空。"
        });
      }

      if (isChatUserMessageTooLong(content)) {
        return res.status(413).json({
          success: false,
          error: "MESSAGE_TOO_LONG",
          message: chatUserMessageLimitMessage()
        });
      }



      // 4. Verify conversation exists and belongs to the user
      phase = "load_conversation";
      const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
      if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "对话会话不存在或无权访问。");
      const conversation = conversationAuthority.conversation;

      // 5. Config & Credentials resolution
      let config: any = {};
      if (instance.config_json) {
        try {
          config = JSON.parse(instance.config_json);
        } catch (e) {}
      }

      phase = "resolve_assist_config";
      const quickConfig = await resolveQuickChatModelConfig(instance, config, model, req.user.id);

      // 6. DB Atomic Turn initialization
      let timeoutSeconds = 180;
      const envTimeoutStr = process.env.MYBAY_CHAT_PENDING_TIMEOUT_SECONDS;
      if (envTimeoutStr) {
        const parsed = parseInt(envTimeoutStr, 10);
        if (Number.isFinite(parsed) && parsed >= 180) {
          timeoutSeconds = parsed;
        }
      }

      phase = "begin_chat_turn";
      let beginResult = await chatRepo.beginChatTurn({
        conversationId,
        userId: req.user.id,
        instanceId: id,
        content: content.trim(),
        requestId: requestId,
        timeoutSeconds,
        metadata: validatedFiles.length > 0 ? buildChatAttachmentMetadata(validatedFiles) : undefined
      });

      if (beginResult.status === 'SEQUENCE_CONFLICT') {
        beginResult = await chatRepo.beginChatTurn({
          conversationId,
          userId: req.user.id,
          instanceId: id,
          content: content.trim(),
          requestId: requestId,
          timeoutSeconds,
          metadata: validatedFiles.length > 0 ? buildChatAttachmentMetadata(validatedFiles) : undefined
        });
      }


      if (beginResult.status === 'DUPLICATE_REQUEST_ID') {
        return res.status(409).json({ success: false, error: "DUPLICATE_REQUEST_ID", message: "重复的请求 Request ID，该请求已被处理。" });
      } else if (beginResult.status === 'CONCURRENT_REQUEST') {
        return res.status(409).json({ success: false, error: "CONCURRENT_REQUEST", message: "当前会话存在正在处理的挂起请求，请稍候再试。" });
      } else if (beginResult.status === 'SEQUENCE_CONFLICT') {
        return res.status(409).json({ success: false, error: "SEQUENCE_CONFLICT", message: "数据库并发冲突：无法获取连续的序列号，请重试。" });
      } else if (beginResult.status !== 'success' || !beginResult.message_id) {
        return res.status(500).json({ success: false, error: "BEGIN_TURN_FAILED", message: "初始化聊天回合失败，数据库未确认挂起态。" });
      }

      emitChatConversationUpdated({
        userId: req.user.id,
        instanceId: id,
        conversationId,
        requestId,
        source: "user_message_created",
        status: "pending"
      });

      const userMessageId = beginResult.message_id;
      pendingConversationId = conversationId;
      pendingUserMessageId = userMessageId;

      // 7. Context assembly and building Assist prompt
      phase = "build_assist_context";
      const rawHistory = await chatRepo.listMessages(conversationId, CHAT_CONTEXT_MESSAGE_LIMIT);
      const history = selectRecentMessagesForContext(rawHistory.filter((message) => message.id !== userMessageId));
      const assistPrompt = await buildAssistContext(skillId, instance, config, conversation, history);

      promptLength = content.length;
      messagesCount = history.length + 1;

      const reasoningInstruction = getReasoningInstruction(normalizedReasoningEffort);
      const defaultMaxTokens = getDefaultMaxTokensForReasoning(normalizedReasoningEffort, 1024);

      let upstreamResponse: { ok: boolean; statusCode?: number; json?: any; message?: string; usage?: any; error?: string; durationMs?: number };
      try {
        phase = "generate_assist_completion";
        const quickMessages = [
          {
            role: "system" as const,
            content: `你是一个专业的麦贝系统助手。请根据下述提供的只读诊断上下文信息，客观、准确、扼要地回答用户。不编造任何信息，不得暴露任何实际 API Key 或凭证密钥。 ${reasoningInstruction}`
          },
          {
            role: "user" as const,
            content: `${assistPrompt}${attachmentContext ? `\n\n${attachmentContext}` : ""}\n\n用户当前输入的消息：\n${content.trim()}`
          }
        ];
        const quickStart = Date.now();
        const quickResult = await generateChatCompletion({
          provider: quickConfig.provider,
          model: quickConfig.model,
          baseUrl: quickConfig.baseUrl,
          providerApiKey: quickConfig.providerApiKey
        }, {
          messages: quickMessages,
          temperature: normalizeChatTemperature(quickConfig.provider, quickConfig.model, temperature),
          maxTokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 2048) : defaultMaxTokens,
          timeoutMs: 90000,
          signal: syncLifecycle.signal
        });

        upstreamResponse = {
          ok: true,
          statusCode: 200,
          message: quickResult.content,
          usage: quickResult.usage || null,
          durationMs: Date.now() - quickStart
        };
      } catch (e: any) {
        if (syncLifecycle.isCancelled()) throw e;
        upstreamResponse = {
          ok: false,
          statusCode: e?.name === "AbortError" ? 504 : 502,
          error: "DIRECT_MODEL_CHAT_FAILED",
          json: { error: e?.message || "Direct model chat failed in Assist mode" },
          durationMs: Date.now() - startTime
        };
      }

      // Commit result
      syncLifecycle.throwIfCancelled();
      acquireNaturalTerminalOwnership();
      if (upstreamResponse.ok && upstreamResponse.message) {
        if (containsDsmlToolCallProtocol(upstreamResponse.message)) {
          phase = "finish_assist_turn_dsml_leak";
          const mapped = buildDsmlToolCallLeakPayload("assist");
          const failureResult = await chatRepo.finishChatTurn({
            conversationId,
            userMessageId,
            status: 'failed',
            errorCode: mapped.error,
            durationMs: Date.now() - startTime
          });
          if (failureResult.status === "failed_logged") {
            syncLifecycle.markFailed();
            turnFinished = true;
            emitChatConversationUpdated({
              userId: req.user.id,
              instanceId: id,
              conversationId,
              requestId,
              source: "message_failed",
              status: "failed"
            });
            return res.status(422).json(mapped);
          }
          throw new Error("CHAT_ASSIST_DSML_LEAK_COMMIT_FAILED");
        }

        phase = "finish_chat_turn_success";
        const finishResult = await chatRepo.finishChatTurn({
          conversationId,
          userMessageId,
          status: 'completed',
          assistantContent: upstreamResponse.message,
          usagePromptTokens: upstreamResponse.usage?.prompt_tokens,
          usageCompletionTokens: upstreamResponse.usage?.completion_tokens,
          usageTotalTokens: upstreamResponse.usage?.total_tokens,
          durationMs: upstreamResponse.durationMs || (Date.now() - startTime)
        });

        if (finishResult.status === 'success') {
          syncLifecycle.markCompleted();
          turnFinished = true;
          auditStatus = "completed";
          emitChatConversationUpdated({
            userId: req.user.id,
            instanceId: id,
            conversationId,
            requestId,
            source: "assistant_message_completed",
            status: "completed"
          });
          return res.json({
            success: true,
            message: upstreamResponse.message,
            assistantMessageId: finishResult.assistant_message_id,
            assistantSequenceNo: finishResult.assistant_sequence_no,
            skillId,
            durationMs: upstreamResponse.durationMs || (Date.now() - startTime)
          });
        }

        if (finishResult.status === 'TURN_NOT_PENDING') {

          syncLifecycle.markFailed();
          turnFinished = true;
          return res.status(408).json({
            success: false,
            error: "TURN_NOT_PENDING",
            message: "回复生成超时。此请求已被超时判定引擎自动丢弃，无法提交对话库。"
          });
        }

        throw new Error("CHAT_TURN_COMMIT_FAILED");
      } else {
        phase = "finish_chat_turn_failure";
        let baseUrlHost: string | null = null;
        if (quickConfig.baseUrl) {
          try {
            let urlStr = quickConfig.baseUrl;
            if (!urlStr.includes("://")) {
              urlStr = "https://" + urlStr;
            }
            const urlObj = new URL(urlStr);
            baseUrlHost = urlObj.hostname;
          } catch (err) {}
        }

        const mapped = {
          success: false,
          error: "DIRECT_MODEL_CHAT_FAILED",
          message: upstreamResponse.json?.error || "辅助模式模型调用失败。",
          diagnostics: {
            provider: quickConfig.provider,
            model: quickConfig.model,
            baseUrlHost: baseUrlHost
          }
        };

        const failureResult = await chatRepo.finishChatTurn({
          conversationId,
          userMessageId,
          status: 'failed',
          errorCode: mapped.error,
          durationMs: Date.now() - startTime
        });

        if (failureResult.status === "failed_logged") {

          syncLifecycle.markFailed();
          turnFinished = true;
          emitChatConversationUpdated({
            userId: req.user.id,
            instanceId: id,
            conversationId,
            requestId,
            source: "message_failed",
            status: "failed"
          });
          return res.status(upstreamResponse.statusCode || 502).json(mapped);
        }

        if (failureResult.status === "TURN_NOT_PENDING") {

          syncLifecycle.markFailed();
          turnFinished = true;
          return res.status(408).json({
            success: false,
            error: "TURN_NOT_PENDING",
            message: "回复生成超时。此请求已被超时判定引擎自动丢弃，无法提交对话库。"
          });
        }

        throw new Error("CHAT_TURN_FAILURE_COMMIT_FAILED");
      }

    } catch (routeErr: any) {
      const isBusinessError = routeErr && typeof routeErr === "object" && routeErr.status && routeErr.error && routeErr.message;
      const safeErrorMessage = isBusinessError ? routeErr.message : extractSafeErrorMessage(routeErr);
      let cancelledByUser = syncLifecycle.isCancelled();
      if (!cancelledByUser && !syncLifecycle.hasCommitOwnership()) {
        if (!syncLifecycle.tryAcquireCommit()) cancelledByUser = syncLifecycle.isCancelled();
      }

      console.error(JSON.stringify({
        operation: "chat_assist_exception",
        instanceId: id,
        conversationId,
        requestId,
        phase,
        errorCode: isBusinessError ? routeErr.error : ((safeErrorMessage === "CHAT_TURN_COMMIT_FAILED" || safeErrorMessage === "CHAT_TURN_FAILURE_COMMIT_FAILED") ? safeErrorMessage : "INTERNAL_ERROR"),
        message: safeErrorMessage,
        errorType: routeErr?.constructor?.name || typeof routeErr,
        durationMs: Date.now() - startTime
      }));

      if (process.env.NODE_ENV !== "production" || process.env.MYBAY_DEBUG_ERRORS === "true") {
        console.error(JSON.stringify({
          operation: "chat_assist_exception_debug",
          instanceId: id,
          conversationId,
          requestId,
          stack: routeErr?.stack || null
        }));
      }

      if (pendingUserMessageId && !turnFinished) {
        try {
          const cleanupResult = await chatRepo.finishChatTurn({
            conversationId,
            userMessageId: pendingUserMessageId,
            status: 'failed',
            errorCode: cancelledByUser ? "CANCELLED_BY_USER" : isBusinessError ? routeErr.error : ((safeErrorMessage === "CHAT_TURN_COMMIT_FAILED" || safeErrorMessage === "CHAT_TURN_FAILURE_COMMIT_FAILED") ? safeErrorMessage : "INTERNAL_ERROR"),
            durationMs: Date.now() - startTime
          });

          if (cleanupResult.status === "failed_logged" || cleanupResult.status === "TURN_NOT_PENDING") {
            turnFinished = true;
          }
        } catch (cleanupErr: any) {}
      }

      if (!cancelledByUser && syncLifecycle.hasCommitOwnership()) syncLifecycle.markFailed();

      if (cancelledByUser) {
        auditStatus = "cancelled";
        if (canWriteHttpResponse(req, res)) {
          return res.status(499).json({ success: false, code: "CANCELLED_BY_USER", error: "CANCELLED_BY_USER", message: "Chat request cancelled." });
        }
        return;
      }

      if (isBusinessError) {
        return res.status(routeErr.status).json({
          success: false,
          error: routeErr.error,
          message: routeErr.message
        });
      }

      if (safeErrorMessage === "CHAT_TURN_METADATA_RPC_MISSING") {
        return res.status(500).json({
          success: false,
          error: "CHAT_TURN_METADATA_RPC_MISSING",
          message: "聊天附件关联所需的数据库函数尚未升级，请先执行 begin_chat_turn 的 metadata 迁移后再发送带附件消息。"
        });
      }

      if (isChatTurnRpcSchemaError(safeErrorMessage)) {
        return res.status(500).json({
          success: false,
          error: "CHAT_TURN_RPC_SCHEMA_MISMATCH",
          message: "AI 对话接口参数架构不匹配，请检查 Runtime 版本的参数规范。"
        });
      }

      const clientErrCode = (safeErrorMessage === "CHAT_TURN_COMMIT_FAILED" || safeErrorMessage === "CHAT_TURN_FAILURE_COMMIT_FAILED") ? safeErrorMessage : "INTERNAL_ERROR";
      const userMessageText = (safeErrorMessage === "CHAT_TURN_COMMIT_FAILED" || safeErrorMessage === "CHAT_TURN_FAILURE_COMMIT_FAILED")
        ? "对话数据提交事务失败，请重试。"
        : "技能辅助模式执行异常，请稍后再试。";

      return res.status(500).json({
        success: false,
        error: clientErrCode,
        message: userMessageText,
        ...((req.user.role === "admin" || req.user.role === "super_admin") ? { debugMessage: safeErrorMessage } : {})
      });
    } finally {
      syncLifecycle.cleanup();
      try {
        await dbAdapter.insertAuditLog({
          instance_id: id,
          action: "chat_workspace_assist",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: JSON.stringify({
            conversationId,
            skillId,
            messagesCount,
            promptLength,
            status: auditStatus,
            timestamp: Date.now()
          })
        });
      } catch (e) {}
    }
  });

  // ======================================================================

}
