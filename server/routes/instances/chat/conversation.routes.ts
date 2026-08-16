import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { dbAdapter } from "../../../db";
import { chatRepo } from "../../../repositories/chatRepo";
import { filesRepo } from "../../../repositories/filesRepo";
import { deleteConversationAttachmentDirectory } from "../../../services/chatAttachmentStorage";
import { isValidInstanceId, isValidUUID } from "./validators";

export function registerConversationRoutes(router: Router) {

  const assertInstanceAccess = async (instanceId: string, userId: string) => {
    const instance = await dbAdapter.getInstanceById(instanceId);
    if (!instance) return { ok: false as const, status: 404, error: "INSTANCE_NOT_FOUND" };
    if (instance.user_id !== userId && instance.owner_id !== userId) {
      return { ok: false as const, status: 403, error: "FORBIDDEN" };
    }
    return { ok: true as const, instance };
  };

  // ======================================================================
  // 0. Conversation Projects
  // ======================================================================
  router.get("/:id/conversation-projects", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    try {
      const access = await assertInstanceAccess(id, req.user.id);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });

      const projects = await chatRepo.listProjects(req.user.id, id);
      return res.json({ success: true, projects });
    } catch (err: any) {
      console.error("[List Conversation Projects Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  router.post("/:id/conversation-projects", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { name } = req.body || {};

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    const projectName = typeof name === "string" ? name.trim() : "";
    if (!projectName || projectName.length > 100) {
      return res.status(400).json({ success: false, error: "INVALID_PROJECT_NAME" });
    }

    try {
      const access = await assertInstanceAccess(id, req.user.id);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });

      const project = await chatRepo.createProject(req.user.id, id, projectName);
      return res.status(201).json({ success: true, project });
    } catch (err: any) {
      console.error("[Create Conversation Project Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  router.patch("/:id/conversation-projects/:projectId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, projectId } = req.params;
    const { name } = req.body || {};

    if (!isValidInstanceId(id) || !isValidUUID(projectId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    const projectName = typeof name === "string" ? name.trim() : "";
    if (!projectName || projectName.length > 100) {
      return res.status(400).json({ success: false, error: "INVALID_PROJECT_NAME" });
    }

    try {
      const access = await assertInstanceAccess(id, req.user.id);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });

      const project = await chatRepo.renameProject(req.user.id, id, projectId, projectName);
      return res.json({ success: true, project });
    } catch (err: any) {
      console.error("[Rename Conversation Project Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  router.delete("/:id/conversation-projects/:projectId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, projectId } = req.params;

    if (!isValidInstanceId(id) || !isValidUUID(projectId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    try {
      const access = await assertInstanceAccess(id, req.user.id);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });

      await chatRepo.archiveProject(req.user.id, id, projectId);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Archive Conversation Project Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ======================================================================
  // 1. Create Conversation
  // ======================================================================
  router.post("/:id/conversations", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { title, projectId } = req.body || {};

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      // Strict instance owner constraint: administrators cannot bypass owner boundary for normal multi-turn chats
      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      if (!title || typeof title !== "string" || title.trim().length === 0) {
        return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "标题不可为空。" });
      }

      if (title.trim().length > 100) {
        return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "标题长度不能超过 100 个字符。" });
      }

      let safeProjectId: string | null = null;
      if (typeof projectId === "string" && projectId.trim()) {
        if (!isValidUUID(projectId)) {
          return res.status(400).json({ success: false, error: "INVALID_PROJECT_ID" });
        }
        const project = await chatRepo.getProject(req.user.id, id, projectId);
        if (!project || project.is_archived) {
          return res.status(404).json({ success: false, error: "PROJECT_NOT_FOUND" });
        }
        safeProjectId = projectId;
      }

      const conversation = await chatRepo.createConversation(req.user.id, id, title.trim(), safeProjectId);
      return res.status(201).json({ success: true, conversation });
    } catch (err: any) {
      console.error("[Create Conversation Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "创建对话会话失败。" });
    }
  });

  // ======================================================================
  // 2. List Conversations (Stable Pagination)
  // ======================================================================
  router.get("/:id/conversations", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    let limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;

    if (isNaN(limit) || limit <= 0) {
      limit = 20;
    }
    limit = Math.min(limit, 50); // Hard maximum of 50

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const conversations = await chatRepo.listConversations(req.user.id, id, limit, cursor);
      
      let nextCursor: string | null = null;
      if (conversations.length === limit) {
        nextCursor = `${conversations[conversations.length - 1].updated_at}|${conversations[conversations.length - 1].id}`;
      }

      return res.json({ success: true, conversations, nextCursor });
    } catch (err: any) {
      console.error("[List Conversations Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "获取会话列表失败。" });
    }
  });

  // ======================================================================
  // 3. Get Single Conversation Detail
  // ======================================================================
  router.get("/:id/conversations/:conversationId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }
    if (!isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "会话 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const conversation = await chatRepo.getConversationForOwnerAndInstance(req.user.id, id, conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, error: "CONVERSATION_NOT_FOUND", message: "对话会话不存在或无权访问。" });
      }

      return res.json({ success: true, conversation });
    } catch (err: any) {
      console.error("[Get Conversation Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "获取会话详情失败。" });
    }
  });

  // ======================================================================
  // 3.5 Update Single Conversation Title (Rename)
  // ======================================================================
  router.patch("/:id/conversations/:conversationId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;
    const { title, projectId, pinned } = req.body || {};

    if (!isValidInstanceId(id) || !isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    const hasTitle = typeof title === "string";
    const hasProjectId = Object.prototype.hasOwnProperty.call(req.body || {}, "projectId");
    const hasPinned = typeof pinned === "boolean";

    if (!hasTitle && !hasProjectId && !hasPinned) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    if (hasTitle && title.trim().length === 0) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    if (hasTitle && title.trim().length > 100) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    try {
      const access = await assertInstanceAccess(id, req.user.id);
      if (!access.ok) return res.status(access.status).json({ success: false, error: access.error });

      const conversation = await chatRepo.getConversationForOwnerAndInstance(req.user.id, id, conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, error: "CONVERSATION_NOT_FOUND" });
      }

      let updated = conversation;
      if (hasTitle) {
        updated = await chatRepo.updateConversationTitle(req.user.id, conversationId, title.trim());
      }

      if (hasProjectId || hasPinned) {
        let safeProjectId: string | null | undefined = undefined;
        if (hasProjectId) {
          if (projectId === null || projectId === "") {
            safeProjectId = null;
          } else if (typeof projectId === "string" && isValidUUID(projectId)) {
            const project = await chatRepo.getProject(req.user.id, id, projectId);
            if (!project || project.is_archived) {
              return res.status(404).json({ success: false, error: "PROJECT_NOT_FOUND" });
            }
            safeProjectId = projectId;
          } else {
            return res.status(400).json({ success: false, error: "INVALID_PROJECT_ID" });
          }
        }

        updated = await chatRepo.updateConversationOrganization(req.user.id, conversationId, {
          projectId: safeProjectId,
          pinnedAt: hasPinned ? (pinned ? new Date().toISOString() : null) : undefined
        });
      }

      return res.json({ success: true, conversation: updated });
    } catch (err: any) {
      console.error("[Update Conversation Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  // ======================================================================
  // 4. Delete Conversation
  // ======================================================================
  router.delete("/:id/conversations/:conversationId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }
    if (!isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "会话 ID 格式错误。" });
    }

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const conversation = await chatRepo.getConversationForOwnerAndInstance(req.user.id, id, conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, error: "CONVERSATION_NOT_FOUND", message: "对话会话不存在或无权访问。" });
      }

      await deleteConversationAttachmentDirectory(id, conversationId);
      await filesRepo.deleteByConversation(id, conversationId);
      await chatRepo.deleteConversation(req.user.id, conversationId);
      return res.json({ success: true, message: "会话已删除。" });
    } catch (err: any) {
      console.error("[Delete Conversation Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "删除会话失败。" });
    }
  });

  // ======================================================================
  // 5. List Messages in Conversation (Stable Pagination)
  // ======================================================================
  router.get("/:id/conversations/:conversationId/messages", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId } = req.params;

    if (!isValidInstanceId(id)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "实例 ID 格式错误。" });
    }
    if (!isValidUUID(conversationId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST", message: "会话 ID 格式错误。" });
    }

    let limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const beforeSeq = req.query.beforeSeq ? parseInt(String(req.query.beforeSeq), 10) : undefined;

    if (isNaN(limit) || limit <= 0) {
      limit = 50;
    }
    limit = Math.min(limit, 100); // Hard maximum of 100

    try {
      const instance = await dbAdapter.getInstanceById(id);
      if (!instance) {
        return res.status(404).json({ success: false, error: "INSTANCE_NOT_FOUND", message: "未找到目标实例。" });
      }

      if (instance.user_id !== req.user.id && instance.owner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "FORBIDDEN", message: "您没有访问该实例的权限。" });
      }

      const conversation = await chatRepo.getConversationForOwnerAndInstance(req.user.id, id, conversationId);
      if (!conversation) {
        return res.status(404).json({ success: false, error: "CONVERSATION_NOT_FOUND", message: "对话会话不存在或无权访问。" });
      }

      const messages = await chatRepo.listMessages(conversationId, limit, beforeSeq);
      const assistantMessageIds = messages
        .filter((message: any) => message.role === "assistant" && isValidUUID(String(message.id || "")))
        .map((message: any) => message.id);
      const feedbackByMessageId: Record<string, string> = assistantMessageIds.length > 0
        ? await chatRepo.listFeedbackByMessageIds(req.user.id, assistantMessageIds)
        : {};
      const messagesWithFeedback = messages.map((message: any) => ({
        ...message,
        user_feedback: message.role === "assistant" ? (feedbackByMessageId[message.id] || null) : null
      }));

      let nextCursorSeq: number | null = null;
      if (messages.length === limit) {
        // Chronological order: first in array has the smallest sequence_no
        nextCursorSeq = messages[0].sequence_no;
      }

      const activeRun = await chatRepo.getActiveRunForConversation(req.user.id, id, conversationId);

      return res.json({ 
        success: true, 
        messages: messagesWithFeedback, 
        nextCursorSeq,
        activeRun: activeRun ? {
          id: activeRun.id,
          status: activeRun.status,
          upstreamRunId: activeRun.upstream_run_id,
          userMessageId: activeRun.user_message_id,
          requestId: activeRun.request_id,
          partialOutput: activeRun.partial_output,
          errorCode: activeRun.error_code,
          lastEventSeq: activeRun.last_event_seq,
          updatedAt: activeRun.updated_at,
          startedAt: activeRun.started_at,
          createdAt: activeRun.created_at
        } : null
      });
    } catch (err: any) {
      console.error("[List Messages Error]", err);
      return res.status(500).json({ success: false, error: "INTERNAL_ERROR", message: "获取消息列表失败。" });
    }
  });

  // ======================================================================

}