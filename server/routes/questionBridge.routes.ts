import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import { authenticateQuestionBridge } from "../services/runs/questionBridgeCredentials";
import { QuestionError, runQuestionsRepo } from "../repositories/runQuestionsRepo";
import { QUESTION_ID } from "../../shared/localRunQuestions";

export function createQuestionBridgeRouter() {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  router.use("/:instanceId", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!authenticateQuestionBridge(req.params.instanceId, req.headers.authorization)) return res.status(401).json({ success: false, error: "UNAUTHORIZED" });
    next();
  });
  router.use(json({ limit: "16kb" }));
  router.post("/:instanceId", (req, res) => {
    try { return res.json({ success: true, question: runQuestionsRepo.create(req.params.instanceId, req.body || {}) }); }
    catch (error) { return res.status(error instanceof QuestionError ? error.status : 500).json({ success: false, error: error instanceof QuestionError ? error.code : "INTERNAL_ERROR" }); }
  });
  router.get("/:instanceId/:questionId", (req, res) => {
    const { nativeRunId, sessionId } = req.query;
    if (typeof nativeRunId !== "string" || !QUESTION_ID.test(nativeRunId) || typeof sessionId !== "string" || !QUESTION_ID.test(sessionId) || !QUESTION_ID.test(req.params.questionId)) return res.status(400).json({ success: false, error: "INVALID_REQUEST" });
    try { return res.json({ success: true, question: runQuestionsRepo.poll(req.params.instanceId, nativeRunId, sessionId, req.params.questionId) }); }
    catch (error) { return res.status(error instanceof QuestionError ? error.status : 500).json({ success: false, error: error instanceof QuestionError ? error.code : "INTERNAL_ERROR" }); }
  });
  return router;
}
