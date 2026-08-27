import { Router, Response } from "express";
import { AuthenticatedRequest, authenticateToken } from "../../../middlewares/auth";
import { chatRepo } from "../../../repositories/chatRepo";
import { isValidInstanceId, isValidUUID } from "./validators";
import {
  resolveConversationAuthority,
  resolveConversationMessageAuthority,
  resolveInstanceAuthority,
} from "../../../services/instances/resourceAuthorityService";

function normalizeRating(value: unknown): "like" | "dislike" | null {
  if (value === "like" || value === "up") return "like";
  if (value === "dislike" || value === "down") return "dislike";
  return null;
}

async function assertFeedbackTarget(params: {
  userId: string;
  instanceId: string;
  conversationId: string;
  messageId: string;
}) {
  const instance = await resolveInstanceAuthority({
    actor: { kind: "user", id: params.userId },
    instanceId: params.instanceId,
  });
  if (instance.ok === false) return { ok: false as const, status: instance.status, error: instance.code };
  const conversation = await resolveConversationAuthority({ instance, conversationId: params.conversationId });
  if (conversation.ok === false) return { ok: false as const, status: conversation.status, error: conversation.code };
  const messageAuthority = await resolveConversationMessageAuthority({ conversation, messageId: params.messageId });
  if (messageAuthority.ok === false) return { ok: false as const, status: messageAuthority.status, error: messageAuthority.code };
  const message = messageAuthority.message;
  if (message.role !== "assistant") {
    return { ok: false as const, status: 400, error: "FEEDBACK_ASSISTANT_ONLY" };
  }

  return { ok: true as const };
}

export function registerFeedbackRoutes(router: Router) {
  router.post("/:id/conversations/:conversationId/messages/:messageId/feedback", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId, messageId } = req.params;
    if (!isValidInstanceId(id) || !isValidUUID(conversationId) || !isValidUUID(messageId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    const rating = normalizeRating(req.body?.rating);
    if (!rating) {
      return res.status(400).json({ success: false, error: "INVALID_RATING" });
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;

    try {
      const target = await assertFeedbackTarget({
        userId: req.user.id,
        instanceId: id,
        conversationId,
        messageId
      });
      if (!target.ok) {
        return res.status(target.status).json({ success: false, error: target.error });
      }

      const data = await chatRepo.upsertMessageFeedback({
        userId: req.user.id,
        instanceId: id,
        conversationId,
        messageId,
        rating,
        reason
      });
      return res.json({ success: true, feedback: data });
    } catch (err: any) {
      console.error("[Chat Message Feedback Upsert Error]", err);
      return res.status(500).json({ success: false, error: "CHAT_MESSAGE_FEEDBACK_FAILED" });
    }
  });

  router.delete("/:id/conversations/:conversationId/messages/:messageId/feedback", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
    const { id, conversationId, messageId } = req.params;
    if (!isValidInstanceId(id) || !isValidUUID(conversationId) || !isValidUUID(messageId)) {
      return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    }

    try {
      const target = await assertFeedbackTarget({
        userId: req.user.id,
        instanceId: id,
        conversationId,
        messageId
      });
      if (!target.ok) {
        return res.status(target.status).json({ success: false, error: target.error });
      }

      await chatRepo.deleteMessageFeedback(req.user.id, messageId);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Chat Message Feedback Delete Error]", err);
      return res.status(500).json({ success: false, error: "CHAT_MESSAGE_FEEDBACK_DELETE_FAILED" });
    }
  });
}
