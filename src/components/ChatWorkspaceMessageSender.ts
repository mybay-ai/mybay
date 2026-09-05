import type React from "react";
import { api } from "../lib/api";
import { humanizeChatError } from "../lib/chatRuntimeErrors";
import { MAX_CHAT_USER_MESSAGE_CHARS, countChatMessageCharacters } from "../../shared/chatMessageContract";
import { isConcurrencyTakeoverError } from "./chat-workspace/chatMessagePolicy";
import { serializeLongTextDraft } from "./chat-workspace/composerLongText";
import {
  buildOptimisticAttachmentMetadata,
  generateUUIDv4,
  type SendOptions,
} from "./chat-workspace/chatWorkspaceSendPolicy";
import {
  type ChatMessage,
  deduplicateMessages,
  shouldAcceptChatResponse,
} from "../lib/chatWorkspaceState";

export function createChatWorkspaceMessageSender(context: any) {
  const {
    uploadInFlightRef,
    conversationCreationInFlightRef,
    loadingConversations,
    isUploading,
    showToast,
    t,
    pendingAttachments,
    input,
    pendingLongTexts = [],
    editingRetryMessageIdRef,
    selectedId,
    setError,
    chatMode,
    runsSupported,
    runsCapabilityState,
    sending,
    activeRunConversationId,
    selectedConversationIdRef,
    setInput,
    enqueueFollowUpMessage,
    setPendingAttachments,
    setMessages,
    shouldScrollToBottomRef,
    selectedConversationId,
    activeRunId,
    waitForRunRelease,
    stopActiveRunStreams,
    resetRunState,
    activeChatGenerationRef,
    activeChatRequestIdRef,
    setSending,
    setToolSteps,
    messageLoadRequestIdRef,
    setLoadingMessages,
    activeSyncChatRequestRef,
    optimisticChatContextRef,
    conversations,
    buildConversationTitleFromMessage,
    selectedIdRef,
    internallySelectingConversationRef,
    setConversations,
    selectConversationId,
    maybeRenameDefaultConversation,
    createChatRunWithRetry,
    a2aRecoveryDraftRef,
    reasoningEffort,
    setActiveRunId,
    setActiveRunConversationId,
    initializeRunExecution,
    setRunMetrics,
    streamActiveRun,
    temperature,
    selectedSkillId,
    refreshAuthoritativeHistory,
  } = context;
  return async (e?: React.FormEvent, customContent?: string, options?: SendOptions) => {
    if (e) {
      e.preventDefault();
    }

    if (loadingConversations) {
      showToast(t("dashboard:chatWorkspace.loadingConversations"), "warning");
      return;
    }
    if (conversationCreationInFlightRef?.current) {
      showToast(t("dashboard:chatWorkspace.creatingConversation"), "warning");
      return;
    }
    if (uploadInFlightRef.current || isUploading) {
      showToast(t("dashboard:chatWorkspace.attachmentUploading", { defaultValue: "附件正在上传中，请稍候..." }), "warning");
      return;
    }
    const usesAttachmentOverride = options?.attachments !== undefined;
    const attachmentsForSend = [...(options?.attachments || pendingAttachments)];

    const messageContent = customContent !== undefined ? customContent : serializeLongTextDraft(pendingLongTexts, input);
    const userMsgContent = messageContent.trim();
    const editingReplaceMessageId = customContent === undefined ? editingRetryMessageIdRef.current : null;
    const sendOptions: SendOptions | undefined = editingReplaceMessageId
      ? { ...options, suppressOptimisticUser: true, replaceMessageId: editingReplaceMessageId }
      : options;
    if (!userMsgContent || !selectedId) return;
    if (countChatMessageCharacters(userMsgContent) > MAX_CHAT_USER_MESSAGE_CHARS) {
      showToast(
        t("dashboard:chatWorkspace.messageTooLong", { max: MAX_CHAT_USER_MESSAGE_CHARS.toLocaleString() }),
        "warning"
      );
      return;
    }

    if (chatMode === "agent" && !runsSupported) {
      const message = runsCapabilityState === "disabled"
        ? t("dashboard:chatWorkspace.asyncRunsDisabled")
        : runsCapabilityState === "checking"
          ? t("dashboard:chatWorkspace.asyncRunsChecking")
          : t("dashboard:chatWorkspace.asyncRunsUnavailable");
      setError(message);
      showToast(message, "warning");
      return;
    }

    const isSameConversationRunning = sending && (!activeRunConversationId || activeRunConversationId === selectedConversationIdRef.current);
    if (isSameConversationRunning) {
      if (enqueueFollowUpMessage(userMsgContent, attachmentsForSend) === false) return;
      if (customContent === undefined) {
        setInput("");
      }
      if (!usesAttachmentOverride && attachmentsForSend.length > 0) setPendingAttachments([]);
      return;
    }

    const isInterruptingActiveRun = false;
    const suppressOptimisticUser = !!sendOptions?.suppressOptimisticUser;
    const replaceMessageId = sendOptions?.replaceMessageId;

    let asyncRunAccepted = false;
    let optimisticUserMessageInserted = false;

    // Generate UUIDs before any async interruption wait so the user message can render immediately.
    let requestId: string;
    let tempUserMsgId: string;
    let tempAssistantMsgId: string;
    try {
      requestId = generateUUIDv4();
      tempUserMsgId = replaceMessageId || `temp-user-${generateUUIDv4()}`;
      tempAssistantMsgId = `assistant-${generateUUIDv4()}`;
    } catch (err: any) {
      if (err?.code === "SECURE_RANDOM_UNAVAILABLE") {
        setError(t("dashboard:chatWorkspace.secureRandomUnavailable"));
        return;
      }
      throw err;
    }

    if (replaceMessageId && editingRetryMessageIdRef.current === replaceMessageId) {
      editingRetryMessageIdRef.current = null;
    }

    const userMsg = userMsgContent;
    const tempUserMsg: ChatMessage = {
      id: tempUserMsgId,
      role: "user" as const,
      content: userMsg,
      status: "completed",
      request_id: requestId,
      conversation_id: selectedConversationIdRef.current,
      metadata: buildOptimisticAttachmentMetadata(attachmentsForSend)
    };
    const interruptNoticeMsg: ChatMessage | null = isInterruptingActiveRun ? {
      id: `interrupt-notice-${generateUUIDv4()}`,
      role: "assistant" as const,
      content: t("dashboard:chatWorkspace.interruptNotice"),
      status: "completed",
      conversation_id: selectedConversationIdRef.current
    } : null;

    const insertOptimisticUserMessage = (conversationId: string | null) => {
      if (!conversationId || optimisticUserMessageInserted || suppressOptimisticUser) return;
      const scopedUserMsg = { ...tempUserMsg, conversation_id: conversationId };
      const scopedInterruptNotice = interruptNoticeMsg ? { ...interruptNoticeMsg, conversation_id: conversationId } : null;
      setMessages(prev => deduplicateMessages([...prev, scopedUserMsg, ...(scopedInterruptNotice ? [scopedInterruptNotice] : [])], conversationId));
      optimisticUserMessageInserted = true;
    };

    const replaceExistingUserMessage = (conversationId: string | null) => {
      if (!replaceMessageId || !conversationId) return;
      setMessages(prev => deduplicateMessages(prev.map(message => (
        message.id === replaceMessageId
          ? { ...message, content: userMsg, status: "completed", conversation_id: conversationId, error_code: undefined, error_message: undefined }
          : message
      )), conversationId));
      optimisticUserMessageInserted = true;
    };

    if (customContent === undefined) {
      setInput("");
    }

    if (isInterruptingActiveRun) {
      insertOptimisticUserMessage(selectedConversationId);
    }

    if (isInterruptingActiveRun && activeRunId) {
      try {
        await api.post(`/api/instances/${selectedId}/runs/${activeRunId}/stop`);
        await waitForRunRelease(selectedId, activeRunId);
      } catch (stopErr) {
        console.warn("[Chat Interrupt] Failed to request stop for active run before sending latest message:", stopErr);
      }
      stopActiveRunStreams();
      resetRunState();
      activeChatGenerationRef.current += 1;
      activeChatRequestIdRef.current = null;
      setSending(false);
      setToolSteps([]);
      setMessages(prev => prev.map(message => {
        if (message.role === "assistant" && message.status === "pending") {
          return { ...message, status: "completed", content: message.content || t("dashboard:chatWorkspace.previousTaskInterrupted") };
        }
        if (message.role === "user" && message.status === "failed" && message.error_code === "TOO_MANY_CONCURRENT_RUNS") {
          return { ...message, status: "superseded", error_message: t("dashboard:chatWorkspace.messageSuperseded") };
        }
        return message;
      }));
    }

    // Increment history request ID to immediately invalidate all in-flight history loads
    messageLoadRequestIdRef.current += 1;
    setLoadingMessages(false);

    const syncController = chatMode === "agent" ? null : new AbortController();
    if (syncController) {
      activeSyncChatRequestRef.current = {
        controller: syncController,
        requestId,
        instanceId: selectedId,
        conversationId: selectedConversationId
      };
    }

    setSending(true);
    setError(null);
    // A queued background dispatch or a late response must not pull a reader
    // away from history. Only a new user submission requests forced following.
    if (!sendOptions?.queuedMessageIds?.length) shouldScrollToBottomRef.current = true;

    let activeConvId = selectedConversationId;
    activeChatRequestIdRef.current = requestId;

    const optimisticUserMessageIds = sendOptions?.queuedMessageIds?.length
      ? sendOptions.queuedMessageIds
      : [tempUserMsgId];

    // Set initial optimistic context
    optimisticChatContextRef.current = {
      instanceId: selectedId,
      conversationId: activeConvId || "",
      requestId,
      userMessageId: optimisticUserMessageIds[0] || tempUserMsgId,
      userMessageIds: optimisticUserMessageIds,
      phase: "sending"
    };

    const initialSelectedId = selectedId;
    const initialConvId = selectedConversationId;
    const currentChatGen = activeChatGenerationRef.current;
    let chatSuccess = false;

    try {
      // Automatic conversation creation if none exists/is active
      if (!activeConvId) {
        const count = conversations.length + 1;
        const title = buildConversationTitleFromMessage(userMsg);
        const convRes = await api.post(`/api/instances/${selectedId}/conversations`, { title }, syncController ? { signal: syncController.signal } : undefined);

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (convRes && convRes.success && convRes.conversation) {
          activeConvId = convRes.conversation.id;
          if (activeSyncChatRequestRef.current?.requestId === requestId) {
            activeSyncChatRequestRef.current.conversationId = activeConvId;
          }
          // Update context with the newly created conversationId
          optimisticChatContextRef.current = {
            instanceId: selectedId,
            conversationId: activeConvId,
            requestId,
            userMessageId: optimisticUserMessageIds[0] || tempUserMsgId,
            userMessageIds: optimisticUserMessageIds,
            phase: "sending"
          };
          internallySelectingConversationRef.current = true;
          setConversations(prev => [convRes.conversation, ...prev]);
          selectConversationId(activeConvId);
        } else {
          throw new Error(t("dashboard:chatWorkspace.autoCreateFailed"));
        }
      }

      if (activeConvId) {
        void maybeRenameDefaultConversation(activeConvId, userMsg);
      }

      replaceExistingUserMessage(activeConvId);
      insertOptimisticUserMessage(activeConvId);

      if (chatMode === "agent") {
        console.debug("[ChatWorkspace] Sending Agent run request.", {
          chatMode,
          runsSupported,
          runsCapabilityState,
          requestPath: `/api/instances/${selectedId}/runs`
        });

        // A locally accepted Stop releases the composer before the Runtime has
        // necessarily released its slot. Keep one request identity while the
        // transport retries that bounded cancellation window.
        const submittedAt = Date.now();
        const recoveryDraft = a2aRecoveryDraftRef?.current;
        const recoverySource = recoveryDraft?.a2aRetryInstanceId === selectedId
          && recoveryDraft?.a2aRetryDraft === userMsg.trim()
          ? recoveryDraft.a2aRecoverySource : undefined;
        const runRes = await createChatRunWithRetry(selectedId, {
          conversationId: activeConvId,
          content: userMsg,
          requestId,
          ...(recoverySource ? { a2aRecoverySource: recoverySource } : {}),
          reasoningEffort,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, true, () => shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        ));

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (runRes && runRes.success && runRes.runId) {
          if (runRes.replayed && !["queued", "running", "stopping"].includes(runRes.status)) {
            // A completed recovery check was reused. Reload its persisted messages
            // instead of adding a new pending answer for a run that already ended.
            setMessages(prev => prev.filter(message => !optimisticUserMessageIds.includes(message.id) && message.id !== tempAssistantMsgId));
            optimisticChatContextRef.current = null;
            if (!usesAttachmentOverride) setPendingAttachments([]);
            chatSuccess = true;
            return;
          }
          if (runRes.replayed && runRes.requestId) {
            const canonicalRequestId = runRes.requestId;
            const resumedAssistantId = `${runRes.runId}-resumed-answer`;
            asyncRunAccepted = true;
            if (!usesAttachmentOverride) setPendingAttachments([]);
            optimisticChatContextRef.current = null;
            setActiveRunId(runRes.runId);
            setActiveRunConversationId(activeConvId);
            initializeRunExecution({
              runId: runRes.runId, conversationId: activeConvId,
              requestId: canonicalRequestId, assistantMessageId: resumedAssistantId,
              status: runRes.status,
            });
            setRunMetrics({ runId: runRes.runId, status: runRes.status });
            setMessages(prev => {
              const retained = prev.filter(message => !optimisticUserMessageIds.includes(message.id) && message.id !== tempAssistantMsgId);
              const existing = retained.some(message => message.role === "assistant" && (message.metadata?.runId === runRes.runId || message.request_id === canonicalRequestId));
              return existing ? retained : [...retained, {
                id: resumedAssistantId, role: "assistant", content: "", status: "pending",
                request_id: canonicalRequestId, conversation_id: activeConvId,
                metadata: { runId: runRes.runId, requestId: canonicalRequestId, ...(recoverySource ? { a2a_recovery_source: recoverySource } : {}) },
              }];
            });
            await refreshAuthoritativeHistory(initialSelectedId, activeConvId);
            void streamActiveRun(runRes.runId, initialSelectedId, activeConvId).catch(err => {
              console.warn("[streamActiveRun] Recovery replay stream failed:", err);
            });
            chatSuccess = true;
            return;
          }
          const acceptedAt = Date.now();
          asyncRunAccepted = true;
          if (!usesAttachmentOverride) setPendingAttachments([]);
          setActiveRunId(runRes.runId);
          setActiveRunConversationId(activeConvId);
          const queuedAt = Date.now();
          initializeRunExecution({
            runId: runRes.runId,
            conversationId: activeConvId,
            requestId,
            assistantMessageId: tempAssistantMsgId,
            status: "queued",
            initialStep: { id: `${runRes.runId}-task_queued`, tool: "agent", label: t("dashboard:chatWorkspace.toolStepAgentTaskQueued"), stepType: "model_reasoning", startedAt: queuedAt }
          });
          setRunMetrics({ runId: runRes.runId, status: "queued", startedAt: queuedAt });
          if (isInterruptingActiveRun) {
            setMessages(prev => prev.map(message => (
              message.role === "user" && message.status === "failed" && message.error_code === "TOO_MANY_CONCURRENT_RUNS"
                ? { ...message, status: "superseded", conversation_id: message.conversation_id || selectedConversationIdRef.current, error_message: t("dashboard:chatWorkspace.messageSuperseded") }
                : message
            )));
          }

          const assistantMsg: ChatMessage = {
            id: tempAssistantMsgId,
            role: "assistant" as const,
            content: "",
            status: "pending",
            request_id: requestId,
            conversation_id: activeConvId,
            metadata: { runId: runRes.runId, requestId, ...(recoverySource ? { a2a_recovery_source: recoverySource } : {}) }
          };
          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              conversationId: activeConvId,
              assistantMessageId: tempAssistantMsgId,
              phase: "settled"
            };
          }
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));

          void streamActiveRun(runRes.runId, initialSelectedId, activeConvId, { submittedAt, acceptedAt }).catch((err) => {
            console.warn("[streamActiveRun] Unhandled promise rejection caught:", err);
          });

          chatSuccess = true;
        } else {
          throw new Error(runRes?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (chatMode === "quick") {
        const res = await api.post(`/api/instances/${selectedId}/conversations/${activeConvId}/chat`, {
          content: userMsg,
          requestId,
          temperature,
          reasoningEffort,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, { signal: syncController!.signal });

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (res && res.success) {
          if (!usesAttachmentOverride) setPendingAttachments([]);
          const assistantMsg: ChatMessage = {
            id: res.assistantMessageId || tempAssistantMsgId,
            role: "assistant" as const,
            content: res.message,
            status: "completed",
            conversation_id: activeConvId,
            sequence_no: res.assistantSequenceNo ?? undefined,
            usage_prompt_tokens: res.usagePromptTokens ?? res.usage?.prompt_tokens ?? res.usage?.input_tokens ?? null,
            usage_completion_tokens: res.usageCompletionTokens ?? res.usage?.completion_tokens ?? res.usage?.output_tokens ?? null,
            usage_total_tokens: res.usageTotalTokens ?? res.usage?.total_tokens ?? res.usage?.totalTokens ?? null,
            duration_ms: res.durationMs ?? null,
            metadata: null
          };
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));
          setConversations(prev => {
            const matched = prev.find(c => c.id === activeConvId);
            if (matched) {
              const updated = { ...matched, updated_at: new Date().toISOString() };
              return [updated, ...prev.filter(c => c.id !== activeConvId)];
            }
            return prev;
          });

          chatSuccess = true;

          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              assistantMessageId: res.assistantMessageId || tempAssistantMsgId,
              phase: "settled"
            };
          }
        } else {
          throw new Error(res?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (chatMode === "assist") {
        const res = await api.post(`/api/instances/${selectedId}/conversations/${activeConvId}/assist`, {
          content: userMsg,
          requestId,
          temperature,
          reasoningEffort,
          skillId: selectedSkillId,
          attachmentIds: attachmentsForSend.map(a => a.id)
        }, { signal: syncController!.signal });

        if (!shouldAcceptChatResponse(
          { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
          { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
        )) {
          return;
        }

        if (res && res.success) {
          if (!usesAttachmentOverride) setPendingAttachments([]);
          const assistantMsg: ChatMessage = {
            id: res.assistantMessageId || tempAssistantMsgId,
            role: "assistant" as const,
            content: res.message,
            status: "completed",
            conversation_id: activeConvId,
            sequence_no: res.assistantSequenceNo ?? undefined
          };
          setMessages(prev => deduplicateMessages([...prev, assistantMsg], activeConvId));
          setConversations(prev => {
            const matched = prev.find(c => c.id === activeConvId);
            if (matched) {
              const updated = { ...matched, updated_at: new Date().toISOString() };
              return [updated, ...prev.filter(c => c.id !== activeConvId)];
            }
            return prev;
          });

          chatSuccess = true;

          if (optimisticChatContextRef.current?.requestId === requestId) {
            optimisticChatContextRef.current = {
              ...optimisticChatContextRef.current,
              assistantMessageId: res.assistantMessageId || tempAssistantMsgId,
              phase: "settled"
            };
          }
        } else {
          throw new Error(res?.message || t("dashboard:chatWorkspace.noAgentResponse"));
        }
      } else if (runsCapabilityState === "disabled") {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsDisabled"));
      } else if (runsCapabilityState === "checking") {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsChecking"));
      } else {
        throw new Error(t("dashboard:chatWorkspace.asyncRunsUnavailable"));
      }
    } catch (err: any) {
      if (!shouldAcceptChatResponse(
        { selectedId: selectedIdRef.current, activeChatRequestId: activeChatRequestIdRef.current, activeChatGeneration: activeChatGenerationRef.current },
        { selectedId: initialSelectedId, requestId, activeChatGeneration: currentChatGen }
      )) {
        return;
      }
      console.error("[Chat Send Error] Full error details:", err, err?.data);
      const humanizedError = humanizeChatError(err, t("dashboard:chatWorkspace.requestFailedAgentOffline"));
      const backendErr = err.data?.error || err.code || "";
      const backendErrCode = String(backendErr).toUpperCase();
      const isTakeoverRace = isConcurrencyTakeoverError(err);
      const backendMsg = typeof err.data?.message === "string" ? err.data.message : "";

      let friendlyMsg = humanizedError.message;

      if (chatMode === "agent") {
        if (backendErrCode === "INSUFFICIENT_CREDITS") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunInsufficientCredits");
        } else if (backendErrCode === "CREDIT_LEDGER_NOT_READY") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunCreditLedgerNotReady");
        } else if (backendErrCode === "CREDIT_LEDGER_UNAVAILABLE") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunCreditLedgerUnavailable");
        } else if (backendErrCode === "FEATURE_DISABLED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.asyncRunsDisabled");
        } else if (backendErrCode === "RUNS_NOT_SUPPORTED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunNotSupported");
        } else if (backendErrCode === "UPSTREAM_UNAVAILABLE") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunUpstreamUnavailable");
        } else if (backendErrCode === "BEGIN_RUN_FAILED") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunBeginFailed");
        } else if (backendErrCode === "INVALID_REQUEST") {
          friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.agentRunInvalidRequest");
        } else if (!backendMsg && backendErrCode) {
          friendlyMsg = t("dashboard:chatWorkspace.agentRunFailedWithCode", { code: backendErrCode });
        }
      }

      if (backendErr === "chat_api_auth_redirected") {
        friendlyMsg = t("dashboard:chatWorkspace.errorInternalRoute", { message: backendMsg || t("dashboard:chatWorkspace.statusNotReady") });
      } else if (backendErr === "CONTAINER_NOT_REDEPLOYED") {
        friendlyMsg = t("dashboard:chatWorkspace.errorNotRedeployed");
      } else if (backendErr === "direct_8642_timeout") {
        friendlyMsg = t("dashboard:chatWorkspace.errorTimeout");
      } else if (backendErr === "direct_8642_refused") {
        friendlyMsg = t("dashboard:chatWorkspace.errorRefused");
      } else if (backendErr === "internal_traefik_route_404") {
        friendlyMsg = t("dashboard:chatWorkspace.errorTraefik404");
      } else if (backendErr === "chat_api_not_ready") {
        friendlyMsg = t("dashboard:chatWorkspace.errorLoading");
      } else if (backendErr === "CHAT_API_NOT_ENABLED") {
        friendlyMsg = humanizedError.message || t("dashboard:chatWorkspace.errorNotEnabled");
      } else if (backendErr === "MODEL_CONFIG_MISSING") {
        friendlyMsg = humanizedError.message || "该实例缺少快速对话所需的配置。";
      } else if (backendErr === "CHAT_TURN_METADATA_RPC_MISSING") {
        friendlyMsg = humanizedError.message || "聊天附件关联所需的数据库函数尚未升级，请先完成数据库迁移后再试。";
      } else if (backendErr === "CHAT_TURN_RPC_SCHEMA_MISMATCH") {
        friendlyMsg = humanizedError.message || "多轮对话数据库函数版本与当前代码不一致，请同步数据库迁移后再试。";
      } else if (backendErr === "DIRECT_MODEL_CHAT_FAILED") {
        const rawMsg = err.data?.message || err.message || "";
        const lowerMsg = rawMsg.toLowerCase();
        let advice = "";

        if (lowerMsg.includes("invalid temperature")) {
          advice = "请检查模型 Temperature 参数或 BYOK 渠道配置。";
        } else if (lowerMsg.includes("invalid api key") || lowerMsg.includes("unauthorized") || lowerMsg.includes("401")) {
          advice = "请检查 API Key 或凭证中心配置。";
        } else if (lowerMsg.includes("quota") || lowerMsg.includes("insufficient") || lowerMsg.includes("limit")) {
          advice = "请检查供应商额度状态或 BYOK 配置。";
        } else if (lowerMsg.includes("model") || lowerMsg.includes("not found")) {
          advice = "请检查模型名称是否仍被供应商支持。";
        } else if (lowerMsg.includes("timeout") || lowerMsg.includes("fetch failed")) {
          advice = "请检查服务器到供应商 API 的网络连通性。";
        } else {
          advice = "直接调用大模型 API 失败，请检查服务商额度或代理。";
        }

        const diagnostics = err.data?.diagnostics;
        if (diagnostics && diagnostics.provider && diagnostics.model) {
          friendlyMsg = `${advice} [供应商: ${diagnostics.provider}, 模型: ${diagnostics.model}] (详情: ${rawMsg})`;
        } else {
          friendlyMsg = `${advice} (详情: ${rawMsg})`;
        }
      } else if (backendErr === "API_KEY_MISSING") {
        friendlyMsg = humanizedError.message || "由于后端无权直接读取容器内局部 .env，请在麦贝控制台的实例设置或平台凭证中心重新配置该供应商的 API 密钥。";
      }

      if (isTakeoverRace) {
        friendlyMsg = t("dashboard:chatWorkspace.agentRunBusyRetry");
      }

      if (optimisticUserMessageInserted) {
        // A rejected creation is not in the follow-up queue. Keep it visibly
        // retryable if the bounded transport retry window has been exhausted.
        setMessages(prev => prev
          .filter(m => m.id !== tempAssistantMsgId)
          .map(m => (m.id === tempUserMsgId || (
            m.role === "user" && m.request_id === requestId && m.conversation_id === activeConvId
          )) ? {
            ...m,
            status: "failed",
            error_code: backendErr || "SEND_FAILED",
            error_message: friendlyMsg
          } : m)
        );
      } else if (sendOptions?.queuedMessageIds?.length) {
        setMessages(prev => prev
          .filter(m => m.id !== tempAssistantMsgId)
          .map(m => sendOptions.queuedMessageIds!.includes(m.id) ? {
            ...m,
            status: "failed",
            error_code: backendErr || "SEND_FAILED",
            error_message: friendlyMsg
          } : m)
        );
      } else {
        setError(friendlyMsg);
      }
      if (optimisticChatContextRef.current?.requestId === requestId) {
        optimisticChatContextRef.current = null;
      }
    } finally {
      if (activeSyncChatRequestRef.current?.requestId === requestId) {
        activeSyncChatRequestRef.current = null;
      }
      const isRequestActive = (
        selectedIdRef.current === initialSelectedId &&
        activeChatGenerationRef.current === currentChatGen &&
        activeChatRequestIdRef.current === requestId
      );

      if (isRequestActive) {
        // Invalidate any history load request made during sending
        messageLoadRequestIdRef.current += 1;
        if (!asyncRunAccepted) {
          setSending(false);
          if (chatSuccess) {
            refreshAuthoritativeHistory(initialSelectedId, activeConvId);
          } else {
            setLoadingMessages(false);
          }
        }
      }
    }
  };
}
