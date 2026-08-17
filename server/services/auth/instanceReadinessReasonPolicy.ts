export function getReasonScore(reason: string): number {
  if (!reason) return 6;
  if (
    reason === "basic_auth_not_enabled" ||
    reason === "missing_hermes_session_cookie" ||
    reason === "hermes_rate_limited" ||
    reason === "invalid_credentials"
  ) {
    return 1;
  }
  if (reason.startsWith("probe_returned_")) {
    const statusStr = reason.substring("probe_returned_".length);
    const status = parseInt(statusStr, 10);
    if (status !== 404 && !(status >= 500 && status < 600)) return 2;
    return 3;
  }
  if (reason.startsWith("status_not_ok_")) {
    const statusStr = reason.substring("status_not_ok_".length);
    const status = parseInt(statusStr, 10);
    if (status >= 500 && status < 600) return 3;
    return 2;
  }
  if (reason === "invalid_json_response") return 4;
  return 5;
}

export function selectBestReason(reasons: string[]): string {
  if (reasons.length === 0) return "no_url_tested";
  let best = reasons[0];
  let bestScore = getReasonScore(best);
  for (let i = 1; i < reasons.length; i++) {
    const score = getReasonScore(reasons[i]);
    if (score < bestScore) {
      best = reasons[i];
      bestScore = score;
    }
  }
  return best;
}

