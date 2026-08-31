import { Router } from "express";
import { authenticateToken, type AuthenticatedRequest } from "../../../middlewares/auth";
import { resolveInstanceAuthority, resolveInstanceRunAuthority } from "../../../services/instances/resourceAuthorityService";
import { authorityActorFromRequest, sendAuthorityFailure } from "../../../services/instances/resourceAuthorityHttp";
import { QuestionError, runQuestionsRepo } from "../../../repositories/runQuestionsRepo";
import { questionBridgeEnabled } from "../../../services/runs/questionBridgeCredentials";
import { installLocalQuestionBridge } from "../../../services/runs/questionBridgeInstaller";
import { isValidInstanceId, isValidUUID } from "./validators";

export function registerRunQuestionRoutes(router: Router) {
  router.get("/:id/question-bridge", authenticateToken, async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isValidInstanceId(req.params.id)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    try {
      const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
      if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
      return res.json({ success: true, installed: questionBridgeEnabled(req.params.id) });
    } catch { return res.status(500).json({ success: false, error: "INTERNAL_ERROR" }); }
  });
  router.post("/:id/question-bridge/install", authenticateToken, async (req: AuthenticatedRequest, res) => {
    if (!isValidInstanceId(req.params.id)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    if (req.body?.restart !== true) return res.status(400).json({ success: false, error: "RESTART_ACKNOWLEDGEMENT_REQUIRED" });
    try {
      const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
      if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
      return res.json({ success: true, ...await installLocalQuestionBridge(authority.instance) });
    } catch (error) { return res.status(error instanceof QuestionError ? error.status : 500).json({ success: false, error: error instanceof QuestionError ? error.code : "QUESTION_INSTALL_FAILED" }); }
  });
  router.get("/:id/runs/:runId/questions", authenticateToken, async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isValidInstanceId(req.params.id) || !isValidUUID(req.params.runId)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    try {
      const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
      if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
      const run = await resolveInstanceRunAuthority({ instance: authority, runId: req.params.runId });
      if (run.ok === false) return sendAuthorityFailure(res, run, "未找到目标任务或无权访问。");
      if (req.query.conversationId !== run.run.conversation_id) return res.status(404).json({ success: false, error: "RUN_NOT_FOUND" });
      return res.json({ success: true, questions: runQuestionsRepo.list(req.params.runId), active: run.run.status === "running" || run.run.status === "queued" });
    } catch { return res.status(500).json({ success: false, error: "INTERNAL_ERROR" }); }
  });
  router.post("/:id/runs/:runId/questions/:questionId", authenticateToken, async (req: AuthenticatedRequest, res) => {
    if (!isValidInstanceId(req.params.id) || !isValidUUID(req.params.runId)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    try {
      const authority = await resolveInstanceAuthority({ actor: authorityActorFromRequest(req), instanceId: req.params.id });
      if (authority.ok === false) return sendAuthorityFailure(res, authority, "无法访问目标实例。");
      const run = await resolveInstanceRunAuthority({ instance: authority, runId: req.params.runId });
      if (run.ok === false) return sendAuthorityFailure(res, run, "未找到目标任务或无权访问。");
      if (req.body?.conversationId !== run.run.conversation_id) return res.status(404).json({ success: false, error: "RUN_NOT_FOUND" });
      return res.json({ success: true, question: runQuestionsRepo.answer(req.params.runId, req.params.questionId, req.body.answer, req.body.reject === true) });
    } catch (error) { return res.status(error instanceof QuestionError ? error.status : 500).json({ success: false, error: error instanceof QuestionError ? error.code : "INTERNAL_ERROR" }); }
  });
}
