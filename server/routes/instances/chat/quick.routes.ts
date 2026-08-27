import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { dbAdapter } from "../../../db";
import { chatRepo } from "../../../repositories/chatRepo";
import { buildChatAttachmentMetadata, buildUnsupportedDirectChatMessage, getUnsupportedDirectChatAttachments, loadAndValidateChatAttachments, processAttachmentsForPrompt } from "../../../utils/chatAttachments";
import { requestTraefikInternal, validateHermesSessionId } from "../../../utils/traefikInternalRequest";
import { mapChatError } from "../../../utils/chatErrorMapper";
import { generateChatCompletion } from "../../../utils/llmClient";
import { containsDsmlToolCallProtocol, buildDsmlToolCallLeakPayload } from "../../../utils/dsmlToolCallGuard";
import { resolveConversationAuthority, resolveInstanceAuthority } from "../../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../../services/instances/resourceAuthorityHttp";
import { emitChatConversationUpdated } from "../../../services/chatRealtime";
import { canWriteHttpResponse, createSyncChatRequestLifecycle } from "../../../services/syncChatCancellation";
import { chatLimiter, extractSafeErrorMessage, getSingleHeader, isChatTurnRpcSchemaError, isValidInstanceId, isValidUUID, normalizeChatTemperature, resolveQuickChatModelConfig } from "./helpers";
import { chatUserMessageLimitMessage, isChatUserMessageTooLong } from "../../../../shared/chatMessageContract";

export function registerQuickRoutes(router: Router) {
  // 6. Active Conversation Chat (Multi-turn Turn Engine)
  // ======================================================================
  router.post("/:id/conversations/:conversationId/chat", authenticateToken, chatLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;
    const { content, requestId, model, temperature, max_tokens, attachmentIds } = req.body;
    const startTime = Date.now();
    console.log(JSON.stringify({
      operation: "chat_workspace_request_received",
      mode: "quick",
      instanceId: id,
      conversationId,
      requestId,
      hasAttachments: Array.isArray(attachmentIds) && attachmentIds.length > 0
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

      // 5. Config & Credentials resolution (Decoupled from Hermes Internal API channels)
      let config: any = {};
      if (instance.config_json) {
        try {
          config = JSON.parse(instance.config_json);
        } catch (e) {}
      }

      phase = "resolve_quick_config";
      const quickConfig = await resolveQuickChatModelConfig(instance, config, model, req.user.id);
      if (config.modelBillingMode === "platform") {
        return res.status(400).json({
          success: false,
          error: "PLATFORM_MODELS_DISABLED",
          message: "Platform-hosted models are not included in the local open-source edition. Use BYOK credentials instead."
        });
      }
      const apiKey = ""; // Bypass internal API keys for direct chats

      // 6. DB Atomic Turn initialization (With retry for SEQUENCE_CONFLICT)
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
        // Safe immediate retry
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

      // 7. Context assembly
      phase = "load_chat_context";
      const history = await chatRepo.getLatestCompletedMessagesForContext(conversationId);
      const hermesMessages = history.map(h => ({
        role: h.role,
        content: h.content
      }));
      hermesMessages.push({ role: 'user', content: content.trim() });

      promptLength = content.length;
      messagesCount = hermesMessages.length;

      // 8. Prepare payload with optional persistent session_id (which is sent over header by the proxy tools)
      const requestBody = {
        messages: hermesMessages,
        model: model || config.model || config.current_model || config.MODEL || undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        max_tokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 1024) : 1024,
        stream: false
      };

      let upstreamResponse: { ok: boolean; statusCode?: number; json?: any; message?: string; usage?: any; sessionId?: string; error?: string; durationMs?: number };
      try {
        phase = "generate_quick_completion";
        const attachmentMessages = attachmentContext
          ? [{ role: "system" as const, content: attachmentContext }]
          : [];

        const quickMessages = [
          {
            role: "system" as const,
            content: "You are a helpful AI assistant. Answer directly and concisely. Do not use tools, search previous conversations, or claim to perform actions in this quick chat mode."
          },
          ...attachmentMessages,
          ...hermesMessages.map((msg) => ({
            role: msg.role === "assistant" ? "assistant" as const : "user" as const,
            content: msg.content
          }))
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
          maxTokens: typeof max_tokens === 'number' ? Math.min(max_tokens, 1024) : 768,
          timeoutMs: 90000,
          signal: syncLifecycle.signal
        });

        upstreamResponse = {
          ok: true,
          statusCode: 200,
          message: quickResult.content,
          usage: quickResult.usage || null,
          sessionId: null,
          durationMs: Date.now() - quickStart
        };
      } catch (e: any) {
        if (syncLifecycle.isCancelled()) throw e;
        upstreamResponse = {
          ok: false,
          statusCode: e?.name === "AbortError" ? 504 : 502,
          error: "DIRECT_MODEL_CHAT_FAILED",
          json: { error: e?.message || "Direct model chat failed" },
          durationMs: Date.now() - startTime
        };
      }

      // 9. Dispatch fallback is retained for reference but skipped in quick chat mode.
      if (!upstreamResponse) {
        // Local node forwarding
        try {
          const response = await requestTraefikInternal({
            instanceId: String(instance.id),
            method: "POST",
            path: "/v1/chat/completions",
            apiKey,
            body: requestBody,
            hermesSessionId: conversation.session_id || undefined,
            timeoutMs: 150000, // 150s upstream timeout
          });

          if (!response.ok) {
            upstreamResponse = {
              ok: false,
              statusCode: response.statusCode || 502,
              error: response.error || "LOCAL_CHAT_FAILED",
              json: response.json
            };
          } else {
            const isJsonValid = response.json !== undefined && 
                               response.json !== null &&
                               Array.isArray(response.json.choices) && 
                               response.json.choices.length > 0 && 
                               response.json.choices[0].message && 
                               typeof response.json.choices[0].message.content === "string";

            if (!isJsonValid) {
              upstreamResponse = { ok: false, statusCode: 502, error: "INVALID_HERMES_RESPONSE" };
            } else {
              upstreamResponse = {
                ok: true,
                statusCode: 200,
                message: response.json.choices[0].message.content,
                usage: response.json.usage || null,
                sessionId: getSingleHeader(response.headers["x-hermes-session-id"]) || getSingleHeader(response.headers["X-Hermes-Session-Id"]) || null,
                durationMs: response.durationMs || (Date.now() - startTime)
              };
            }
          }
        } catch (e: any) {
          upstreamResponse = { ok: false, statusCode: 504, error: "LOCAL_ROUTE_TIMEOUT" };
        }
      }

      // 10. Handle upstream resolution atomically via finishChatTurn
      syncLifecycle.throwIfCancelled();
      acquireNaturalTerminalOwnership();
      if (upstreamResponse.ok) {
        phase = "finish_chat_turn_success";
        // Session ID validation with security guidelines
        const upstreamSessionId = upstreamResponse.sessionId;
        let validatedSessionId: string | undefined = undefined;

        if (upstreamSessionId) {
          if (validateHermesSessionId(upstreamSessionId)) {
            validatedSessionId = upstreamSessionId;
          } else {
            console.warn("[Chat Session ID Validation Warn] Skipping registration of invalid session ID.");
          }
        }

        if (containsDsmlToolCallProtocol(upstreamResponse.message)) {
          phase = "finish_chat_turn_dsml_leak";
          const mapped = buildDsmlToolCallLeakPayload("quick");
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
          throw new Error("CHAT_TURN_DSML_LEAK_COMMIT_FAILED");
        }

        const promptTokens = upstreamResponse.usage?.prompt_tokens || null;
        const compTokens = upstreamResponse.usage?.completion_tokens || null;
        const totTokens = upstreamResponse.usage?.total_tokens || null;
        const durMs = upstreamResponse.durationMs || (Date.now() - startTime);

        const finishResult = await chatRepo.finishChatTurn({
          conversationId,
          userMessageId,
          status: 'completed',
          assistantContent: upstreamResponse.message,
          usagePromptTokens: promptTokens,
          usageCompletionTokens: compTokens,
          usageTotalTokens: totTokens,
          durationMs: durMs,
          newSessionId: validatedSessionId
        });

        if (finishResult.status === "success") {
          syncLifecycle.markCompleted();
          turnFinished = true;
          auditStatus = "success";
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
            usage: upstreamResponse.usage || null,
            durationMs: durMs
          });
        }

        if (finishResult.status === "TURN_NOT_PENDING") {

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
        // Upstream failed: clean up pending message to failed in database
        let mapped: any;
        if (upstreamResponse.error === "DIRECT_MODEL_CHAT_FAILED") {
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
          mapped = {
            success: false,
            error: "DIRECT_MODEL_CHAT_FAILED",
            message: upstreamResponse.json?.error || "快速对话调用失败。",
            diagnostics: {
              provider: quickConfig.provider,
              model: quickConfig.model,
              baseUrlHost: baseUrlHost
            }
          };
        } else {
          mapped = mapChatError({
            statusCode: upstreamResponse.statusCode,
            error: upstreamResponse.error,
            json: upstreamResponse.json
          });
        }

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
          // Hide diagnostics for non-privileged clients EXCEPT DIRECT_MODEL_CHAT_FAILED
          if (mapped.diagnostics && mapped.error !== "DIRECT_MODEL_CHAT_FAILED") {
            delete mapped.diagnostics;
          }
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
        operation: "chat_multiturn_exception",
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
          operation: "chat_multiturn_exception_debug",
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
          } else {
            console.error(JSON.stringify({
              operation: "chat_cleanup_exception",
              instanceId: id,
              conversationId,
              requestId,
              errorCode: "CLEANUP_FAILED",
              status: cleanupResult.status,
              durationMs: Date.now() - startTime
            }));
          }
        } catch (cleanupErr: any) {
          console.error(JSON.stringify({
            operation: "chat_cleanup_exception",
            instanceId: id,
            conversationId,
            requestId,
            errorCode: "CLEANUP_FAILED",
            durationMs: Date.now() - startTime
          }));
        }
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
        : "多轮对话代理模块执行异常，请稍后再试。";

      return res.status(500).json({
        success: false,
        error: clientErrCode,
        message: userMessageText,
        ...((req.user.role === "admin" || req.user.role === "super_admin") ? { debugMessage: safeErrorMessage } : {})
      });
    } finally {
      syncLifecycle.cleanup();
      // Lightweight audit log
      try {
        await dbAdapter.insertAuditLog({
          instance_id: id,
          action: "chat_workspace_multiturn",
          user_id: req.user.id,
          timestamp: new Date().toISOString(),
          details: JSON.stringify({
            conversationId,
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
