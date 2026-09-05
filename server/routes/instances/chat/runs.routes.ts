import { readA2ARecoverySource } from "../../../../shared/a2aRecovery";
import { readA2AActivities } from "../../../services/a2aActivity";
import { NextFunction, Router, Response } from "express";
import * as crypto from "crypto";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { chatRepo } from "../../../repositories/chatRepo";
import { probeCapabilities, probeCapabilitiesDetailed } from "../../../utils/capabilities";
import {
  discardRunFileSnapshot,
  emitRunLifecycleStep,
  primeRunFileSnapshot,
  RECONCILER_ID,
  requestRunReconcile,
  requestRunsAPI,
  requestRunsReconcile,
} from "../../../services/runsReconciler";
import { emitChatConversationUpdated } from "../../../services/chatRealtime";
import { runsLimiter } from "./limiters";
import { isValidInstanceId, isValidUUID } from "./validators";
import { buildChatAttachmentMetadata, loadAndValidateChatAttachments } from "../../../utils/chatAttachments";
import { guardManagedOperation } from "../../../utils/managedOperationGuard";
import { isInteractiveRunsEnabled, resolveInteractiveRunsAvailability } from "../../../utils/interactiveRuns";
import { chatUserMessageLimitMessage, isChatUserMessageTooLong } from "../../../../shared/chatMessageContract";
import { normalizeReasoningEffort } from "./helpers";
import {
  resolveConversationAuthority,
  resolveInstanceAuthority,
  resolveInstanceRunAuthority,
} from "../../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../../services/instances/resourceAuthorityHttp";
import { runtimeRegistry } from "../../../runtime/runtimeRegistry";
import { safeLocalEvidencePath } from "../../../../shared/localRunFileEvidence";
import { getStoredFileDiff } from "../../../services/runs/runFileSnapshots";
import { isQuestionBridgeInstalling } from "../../../services/runs/questionBridgeInstaller";
import { createConfiguredModelEvidence } from "../../../../shared/localModelEvidence";
import { DEFAULT_RUN_LEASE_POLICY } from "../../../services/runs/runLease";
import { createChatGroupRun, readChatGroupConfig } from "../../../../shared/chatCollaboration";
import { normalizeA2AAgentName, normalizeA2APeerIds, supportsA2AByVersion } from "../../../../shared/a2aConfig";
import { dbAdapter } from "../../../db";

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
  router.get("/:id/runs/:runId/file-diff", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const { id, runId } = req.params;
    const requestedPath = safeLocalEvidencePath(req.query.path);
    const conversationId = req.query.conversationId;
    if (!isValidInstanceId(id) || !isValidUUID(runId) || typeof conversationId !== "string" || !isValidUUID(conversationId) || !requestedPath) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }
    try {
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const runAuthority = await resolveInstanceRunAuthority({ instance: instanceAuthority, runId });
      if (runAuthority.ok === false) return sendAuthorityFailure(res, runAuthority, "未找到目标任务或无权访问。");
      if (runAuthority.run.conversation_id !== conversationId) return res.status(404).json({ success: false, error: "RUN_NOT_FOUND" });
      return res.json({ success: true, ...getStoredFileDiff(runAuthority.run, requestedPath) });
    } catch {
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });


  // ======================================================================
  // 12b. Check Async Runs Capabilities
  // ======================================================================
  router.get("/:id/runs-capabilities", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    try {
      const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
      const instance = authority.instance;

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

    const requestStartedAt = Date.now();
    const acceptTiming: Record<string, number> = {};
    let primedSnapshotRunId: string | null = null;
    const { id } = req.params;
    const { conversationId, content, requestId, reasoningEffort, attachmentIds } = req.body;
    if (isQuestionBridgeInstalling(id)) return res.status(409).json({ success: false, error: "INSTANCE_BUSY" });
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
      const authorityStartedAt = Date.now();
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const conversationAuthority = await resolveConversationAuthority({ instance: instanceAuthority, conversationId });
      if (conversationAuthority.ok === false) return sendAuthorityFailure(res, conversationAuthority, "对话会话不存在或无权访问。");
      acceptTiming.authorityMs = Date.now() - authorityStartedAt;
      const instance = instanceAuthority.instance;

      let validatedFiles: any[] = [];
      const attachmentValidationStartedAt = Date.now();
      try {
        validatedFiles = await loadAndValidateChatAttachments({
          attachmentIds,
          userId: req.user.id,
          instanceId: id,
          conversationId,
          authority: conversationAuthority,
        });
      } catch (attachmentErr: any) {
        return res.status(attachmentErr.status || 400).json({
          success: false,
          error: attachmentErr.error || "INVALID_ATTACHMENT",
          message: attachmentErr.message || "Invalid attachment."
        });
      } finally {
        acceptTiming.attachmentValidationMs = Date.now() - attachmentValidationStartedAt;
      }
      const config = instance.config_json ? JSON.parse(instance.config_json) : {};
      if (config.modelBillingMode === "platform") {
        return res.status(400).json({
          success: false,
          error: "PLATFORM_MODELS_DISABLED",
          message: "Platform-hosted models are not included in the local open-source edition. Use BYOK credentials instead."
        });
      }

      const capabilityProbeStartedAt = Date.now();
      const cap = await probeCapabilities(instance);
      acceptTiming.capabilityProbeMs = Date.now() - capabilityProbeStartedAt;
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

      const recoverySource = readA2ARecoverySource(req.body.a2aRecoverySource);
      if (req.body.a2aRecoverySource != null) {
        const sourceActivity = recoverySource && readA2AActivities({ instanceId: id, includeAll: true }).find(a => a.contextId === recoverySource.contextId && a.taskId === recoverySource.taskId && a.peerId === recoverySource.peerId && a.direction === "outbound");
        if (!sourceActivity || !config.a2aEnabled || !Array.isArray(config.a2aPeerIds) || !config.a2aPeerIds.includes(recoverySource!.peerId)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
      }
      const runId = crypto.randomUUID();
      const groupConfig = readChatGroupConfig(conversationAuthority.conversation.collaboration);
      let groupCollaboration = null;
      if (groupConfig) {
        const trustedPeerIds = new Set(normalizeA2APeerIds(config.a2aPeerIds, id));
        if (config.a2aEnabled !== true || groupConfig.peerIds.some(peerId => !trustedPeerIds.has(peerId))) {
          return res.status(409).json({ success: false, error: "GROUP_ROOM_CONFIGURATION_STALE" });
        }
        const availableInstances = await dbAdapter.getInstances(req.user.id, req.user.role);
        const peers = groupConfig.peerIds.flatMap(peerId => {
          const peer: any = availableInstances.find((candidate: any) => candidate.id === peerId);
          if (!peer) return [];
          let peerConfig: any = {};
          try { peerConfig = typeof peer.config_json === "string" ? JSON.parse(peer.config_json) : (peer.config_json || {}); } catch {}
          const peerVersion = String(peer.resolved_version || peer.agent_image_tag || peer.agent_version || "");
          if (peerConfig.a2aEnabled !== true || !supportsA2AByVersion(peerVersion, peer.capabilities)) return [];
          return [{ id: String(peer.id), name: normalizeA2AAgentName(peer.name, peerConfig.a2aAgentName || peer.id) }];
        });
        if (peers.length !== groupConfig.peerIds.length) {
          return res.status(409).json({ success: false, error: "GROUP_ROOM_MEMBER_UNAVAILABLE" });
        }
        groupCollaboration = createChatGroupRun({
          runId,
          leader: { id, name: normalizeA2AAgentName(instance.name, config.a2aAgentName || id) },
          peers,
          maxRounds: groupConfig.maxRounds,
        });
        if (!groupCollaboration) return res.status(409).json({ success: false, error: "GROUP_ROOM_CONFIGURATION_STALE" });
      }

      // Authorization/attachment checks above await I/O. Recheck at the commit
      // boundary so an install started during those awaits cannot restart a new Run.
      if (isQuestionBridgeInstalling(id)) return res.status(409).json({ success: false, error: "INSTANCE_BUSY" });
      primeRunFileSnapshot(runId, id);
      primedSnapshotRunId = runId;
      const persistStartedAt = Date.now();
      const beginResult = await chatRepo.beginChatRun({
        ...(groupCollaboration ? { groupCollaboration } : {}),
        ...(recoverySource ? { a2aRecoverySource: recoverySource, a2aRecoveryFingerprint: crypto.createHash("sha256").update(JSON.stringify({ content: content.trim(), attachmentIds: validatedFiles.map(file => file.id).sort(), reasoningEffort: normalizedReasoningEffort })).digest("hex") } : {}),
        conversationId,
        userId: req.user.id,
        instanceId: id,
        content: content.trim(),
        requestId: requestId.trim(),
        runId,
        reasoningEffort: normalizedReasoningEffort,
        runtimeBinding: runtimeRegistry.createBindingForInstance(instance),
        modelEvidence: createConfiguredModelEvidence(config.model || config.current_model || config.MODEL || instance.model_name),
        initialLease: {
          reconcilerId: RECONCILER_ID,
          leaseSeconds: DEFAULT_RUN_LEASE_POLICY.leaseSeconds,
        },
      });
      acceptTiming.persistMs = Date.now() - persistStartedAt;

      if (beginResult.status !== "success") {
        discardRunFileSnapshot(runId);
        primedSnapshotRunId = null;
      }

      if (beginResult.status === 'IDEMPOTENT_REPLAY' && beginResult.run_id) {
        if (["queued", "running", "stopping"].includes(String(beginResult.run_status))) {
          requestRunsReconcile();
        }
        console.info(JSON.stringify({
          operation: "chat_run_accept_timing",
          runId: beginResult.run_id,
          instanceId: id,
          replayed: true,
          ...acceptTiming,
          totalMs: Date.now() - requestStartedAt,
        }));
        return res.status(200).json({
          success: true,
          replayed: true,
          requestId: beginResult.request_id,
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
        const attachmentMetadataStartedAt = Date.now();
        try {
          await chatRepo.updateChatMessageMetadata(beginResult.user_message_id, buildChatAttachmentMetadata(validatedFiles));
        } catch (metadataErr: any) {
          discardRunFileSnapshot(runId);
          primedSnapshotRunId = null;
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
        } finally {
          acceptTiming.attachmentMetadataMs = Date.now() - attachmentMetadataStartedAt;
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
      if (!requestRunReconcile(runId)) {
        // A targeted wake normally consumes the lease created with the Run. If
        // the scheduler is not ready, release it before falling back to the
        // broad scanner so the new Run remains immediately claimable.
        const releasedInitialLease = await chatRepo.releaseRunLease({
          runId,
          reconcilerId: RECONCILER_ID,
        });
        if (!releasedInitialLease) {
          console.warn(JSON.stringify({
            operation: "chat_run_initial_lease_release_failed",
            runId,
            instanceId: id,
          }));
        }
        requestRunsReconcile();
      }
      primedSnapshotRunId = null;

      console.info(JSON.stringify({
        operation: "chat_run_accept_timing",
        runId,
        instanceId: id,
        replayed: false,
        ...acceptTiming,
        totalMs: Date.now() - requestStartedAt,
      }));
      return res.status(202).json({
        success: true,
        runId,
        status: "queued",
        userMessageId: beginResult.user_message_id,
        sequenceNo: beginResult.sequence_no
      });

    } catch (err: any) {
      if (primedSnapshotRunId) discardRunFileSnapshot(primedSnapshotRunId);
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
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const runAuthority = await resolveInstanceRunAuthority({ instance: instanceAuthority, runId });
      if (runAuthority.ok === false) return sendAuthorityFailure(res, runAuthority, "未找到目标任务或无权访问。");
      const run = runAuthority.run;

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
      const instanceAuthority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: id });
      if (instanceAuthority.ok === false) return sendAuthorityFailure(res, instanceAuthority, "无法访问目标实例。");
      const runAuthority = await resolveInstanceRunAuthority({ instance: instanceAuthority, runId });
      if (runAuthority.ok === false) return sendAuthorityFailure(res, runAuthority, "未找到目标任务或无权访问。");
      const run = runAuthority.run;

      const stopResult = await chatRepo.requestStopChatRun({
        runId,
        userId: req.user.id,
        instanceId: id
      });

      if (stopResult.status === 'stop_requested') {
        requestRunsReconcile();
        return res.json({
          success: true,
          status: "stopping",
          message: "中止请求已发送。"
        });
      } else if (stopResult.status === 'already_stopping') {
        requestRunsReconcile();
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


