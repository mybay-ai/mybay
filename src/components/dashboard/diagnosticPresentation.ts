export type DiagnosticRecoveryAction = "view_logs" | "open_instance_settings" | "open_channel_settings" | "open_password_reset" | "redeploy";

export type DiagnosticCheckView = {
  code: string;
  domain: "container" | "host" | "dashboard" | "chat" | "model" | "channel";
  label: string;
  status: "pass" | "warning" | "fail" | "checking" | "not_applicable";
  detail: string;
  reasonCode?: string;
  suggestion?: string;
  recoveryAction?: DiagnosticRecoveryAction;
  recheckable?: boolean;
};

export function settleTimedOutDiagnosticChecks(checks: DiagnosticCheckView[], timedOut: boolean): DiagnosticCheckView[] {
  if (!timedOut) return checks;
  return checks.map((check) => check.status === "checking" ? {
    ...check,
    status: "warning",
    detail: "检测超时，当前状态尚未收敛",
    reasonCode: "DIAGNOSTIC_CHECK_TIMEOUT",
    suggestion: "查看实时日志确认实例仍在启动，处理异常后再次检测。",
    recoveryAction: "view_logs",
  } : check);
}

export function isCompleteDiagnosticPass(summary: any) {
  if (!summary || typeof summary !== "object") return false;
  return Number(summary?.failed || 0) === 0 && Number(summary?.checking || 0) === 0;
}
