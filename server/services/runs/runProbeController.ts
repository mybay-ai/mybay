import { usageWithReportedModel } from "../../../shared/localRunUsage";
export type TerminalProbeOutcome =
  | {
      status: "completed";
      assistantContent: string;
      usage: Record<string, unknown>;
      durationMs: number | null;
    }
  | {
      status: "failed";
      error: string;
    }
  | {
      status: "cancelled";
      errorCode: "CANCELLED_UPSTREAM";
    };

export interface PartialOutputResolution {
  hasPartialOutput: boolean;
  changed: boolean;
  newOutput: string;
  delta: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function resolveMaxRuntimeMs(rawSeconds: unknown): number {
  const parsed = parseInt(typeof rawSeconds === "string" ? rawSeconds : "1800", 10);
  const seconds = Math.max(60, Math.min(7200, Number.isNaN(parsed) ? 1800 : parsed));
  return seconds * 1000;
}

export function hasRunExceededRuntime(createdAt: unknown, maxRuntimeMs: number, nowMs: number): boolean {
  const createdMs = new Date(String(createdAt)).getTime();
  return nowMs - createdMs > maxRuntimeMs;
}

export function resolveTerminalProbeOutcome(
  payload: unknown,
  _fallbackDurationMs: number,
): TerminalProbeOutcome | null {
  if (!isRecord(payload)) return null;
  const status = payload.status;
  if (status === "completed") {
    const output = payload.output;
    const nestedMessage = isRecord(output) && isRecord(output.message) ? output.message : null;
    const primaryContent = typeof output === "string"
      ? output
      : typeof nestedMessage?.content === "string"
        ? nestedMessage.content
        : "";
    const assistantContent = primaryContent ||
      (typeof payload.message === "string" ? payload.message : "") ||
      (typeof payload.content === "string" ? payload.content : "");
    const durationMs = typeof payload.duration_ms === "number" && Number.isSafeInteger(payload.duration_ms) && payload.duration_ms >= 0 ? payload.duration_ms : null;
    return {
      status,
      assistantContent,
      usage: usageWithReportedModel(isRecord(payload.usage) ? payload.usage : {}, payload.model) as Record<string, unknown>,
      durationMs,
    };
  }
  if (status === "failed") {
    const rawError = payload.error || payload.message || payload.error_code || "RUN_FAILED_UPSTREAM";
    return { status, error: String(rawError) };
  }
  if (status === "cancelled" || status === "cancelled_by_user") {
    return { status: "cancelled", errorCode: "CANCELLED_UPSTREAM" };
  }
  return null;
}

export function resolvePartialOutput(previousOutput: string, upstreamPartialOutput: unknown): PartialOutputResolution {
  const hasPartialOutput = typeof upstreamPartialOutput === "string";
  const newOutput = hasPartialOutput ? upstreamPartialOutput : previousOutput;
  if (!hasPartialOutput || newOutput === previousOutput) {
    return { hasPartialOutput, changed: false, newOutput, delta: "" };
  }
  return {
    hasPartialOutput,
    changed: true,
    newOutput,
    delta: newOutput.startsWith(previousOutput) ? newOutput.substring(previousOutput.length) : newOutput,
  };
}

export type ProbeFailureDecision = "upstream_not_found" | "zombie_timeout" | "retry";

export function resolveProbeFailure(statusCode: number, lastActiveMs: number, nowMs: number): ProbeFailureDecision {
  if (statusCode === 404) return "upstream_not_found";
  const effectiveLastActive = Number.isFinite(lastActiveMs) ? lastActiveMs : nowMs;
  return nowMs - effectiveLastActive > 180_000 ? "zombie_timeout" : "retry";
}

export function isImmediateStopCancellation(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload.status === "cancelled" || payload.status === "cancelled_by_user";
}
