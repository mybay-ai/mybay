import rateLimit from "express-rate-limit";
import { getClientIp } from "../../../utils/ip";

export const conversationSearchLimiterOptions = {
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req: any) => `conversation_search:ip:${getClientIp(req)}:user:${req.user?.id || "anon"}`,
  message: {
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "会话搜索请求过于频繁，请稍后再试。"
  }
};

export const conversationWriteLimiterOptions = {
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req: any) => `conversation_write:ip:${getClientIp(req)}:user:${req.user?.id || "anon"}`,
  message: {
    success: false,
    error: "RATE_LIMIT_EXCEEDED",
    message: "会话管理操作过于频繁，请稍后再试。"
  }
};

export const conversationSearchLimiter = rateLimit(conversationSearchLimiterOptions);
export const conversationWriteLimiter = rateLimit(conversationWriteLimiterOptions);
