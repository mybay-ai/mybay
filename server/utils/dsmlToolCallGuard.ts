const DSML_MARKER_RE = /<[^>]*(?:DSML|ＤＳＭＬ)[^>]*(?:tool_calls|invoke|parameter)[^>]*>/i;
const DSML_TEXT_RE = /(?:DSML|ＤＳＭＬ).{0,80}(?:tool_calls|invoke\s+name|parameter\s+name)/is;

export const DSML_TOOL_CALL_ERROR_CODE = "TOOL_CALL_PROTOCOL_LEAK";

export function containsDsmlToolCallProtocol(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  return DSML_MARKER_RE.test(text) || DSML_TEXT_RE.test(text);
}

export function getDsmlToolCallLeakMessage(mode: "quick" | "assist" | "agent" = "agent"): string {
  if (mode === "quick") {
    return "当前模型返回了未执行的工具调用协议。Quick 模式不会执行工具，请切换 Agent 模式重试。";
  }
  if (mode === "assist") {
    return "当前模型返回了未执行的工具调用协议。Assist 模式仅做轻量诊断，请切换 Agent 模式执行带工具的任务。";
  }
  return "Agent 返回了未执行的工具调用协议，系统已阻止协议文本展示。请重新发送，或检查该实例是否支持 Hermes Runs 工具执行链路。";
}

export function buildDsmlToolCallLeakPayload(mode: "quick" | "assist" | "agent" = "agent") {
  return {
    success: false,
    error: DSML_TOOL_CALL_ERROR_CODE,
    message: getDsmlToolCallLeakMessage(mode)
  };
}
