export interface BlueprintChildResult {
  templateId: string;
  readiness: string;
  initializationFailed: boolean;
}

export function summarizeBlueprintChildResults(expected: number, children: BlueprintChildResult[]) {
  const failed = children.filter((item) => item.initializationFailed || item.readiness === "failed").length;
  const successful = children.length - failed;
  const ready = children.filter((item) => !item.initializationFailed && item.readiness === "ready").length;
  const configRequired = children.filter((item) => !item.initializationFailed && ["config_required", "authorization_required", "file_required"].includes(item.readiness)).length;
  const missing = Math.max(0, expected - children.length);
  const totalFailed = failed + missing;
  const status = totalFailed > 0 ? (successful > 0 ? "degraded" : "failed") : configRequired > 0 ? "config_required" : "success";
  return { expected, successful, ready, configRequired, failed: totalFailed, status };
}
