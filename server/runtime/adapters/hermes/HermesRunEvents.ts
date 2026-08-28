import { containsDsmlToolCallProtocol, DSML_TOOL_CALL_ERROR_CODE } from "../../../utils/dsmlToolCallGuard";
import { isStreamingDecoderCompatError } from "./HermesProtocol";
import { truncateSafeText } from "../../../services/runs/runSafeText";
import { sanitizeStep } from "../../../services/runs/runStepSanitizer";
import type {
  RuntimeRunEventController,
  RuntimeRunEventDependencies,
  RuntimeRunEventProvider,
  RuntimeRunEventTarget,
  RuntimeRunEventTracker,
} from "../../contracts";

const TERMINAL_COMPLETED_EVENTS = new Set(["run.completed", "run.complete"]);
const TERMINAL_OTHER_EVENTS = new Set(["run.failed", "run.error", "run.cancelled", "run.canceled"]);
const ALLOWED_APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

function normalizeApprovalChoices(choices: unknown): string[] {
  const incoming = Array.isArray(choices) ? choices : [];
  const normalized = incoming
    .map((choice: any) => String(choice?.id || choice?.value || choice || "").toLowerCase().trim())
    .filter((choice) => ALLOWED_APPROVAL_CHOICES.has(choice));
  return Array.from(new Set(normalized.length > 0 ? normalized : ["once", "deny"]));
}

export class HermesRunEventProvider implements RuntimeRunEventProvider {
  createController(dependencies: RuntimeRunEventDependencies): RuntimeRunEventController {
    const trackers = new Map<string, RuntimeRunEventTracker>();

    function getOrCreate(runId: string, initialPartialOutput: unknown = ""): RuntimeRunEventTracker {
      let tracker = trackers.get(runId);
      if (!tracker) {
        tracker = {
          lastPartialOutput: typeof initialPartialOutput === "string" ? initialPartialOutput : "",
          sentSteps: new Map(),
          activeToolIds: new Map(),
        };
        trackers.set(runId, tracker);
      }
      return tracker;
    }

    function emitStep(
      runId: string,
      tracker: RuntimeRunEventTracker,
      step: unknown,
      ownerId?: string,
    ): void {
      const sanitized = sanitizeStep(step);
      const cacheKey = `${sanitized.status}:${sanitized.safe_summary}`;
      if (tracker.sentSteps.get(sanitized.id) === cacheKey) return;
      tracker.sentSteps.set(sanitized.id, cacheKey);
      dependencies.addEvent(runId, "step", JSON.stringify(sanitized), ownerId);
    }

    function sanitizeApprovalEvent(event: Record<string, any>, status: "pending" | "resolved") {
      const rawId = String(event.approval_id || event.approvalId || event.id || event.request_id || "");
      const id = /^[A-Za-z0-9_.:-]{1,160}$/.test(rawId)
        ? rawId
        : `approval-${dependencies.randomUUID()}`;
      return {
        id,
        status,
        title: truncateSafeText(event.title || event.name || event.action, 120),
        description: truncateSafeText(event.description || event.message || event.reason, 500),
        command: truncateSafeText(event.command, 700),
        choices: normalizeApprovalChoices(event.choices),
        choice: truncateSafeText(event.choice, 40),
        smartDenied: event.smart_denied === true || event.smartDenied === true,
        allowPermanent: event.allow_permanent === true || event.allowPermanent === true,
        timestamp: typeof event.timestamp === "number" ? event.timestamp : dependencies.now() / 1000,
      };
    }

    async function completeTerminalEvent(
      run: RuntimeRunEventTarget,
      rawEvent: unknown,
      upstreamRunId: string,
    ): Promise<boolean> {
      if (!rawEvent || typeof rawEvent !== "object") return false;
      const event = rawEvent as Record<string, any>;
      const eventType = String(event.event || event.type || "");
      const tracker = trackers.get(run.id);
      const durationMs = Number.isFinite(Number(event.duration_ms)) ? Number(event.duration_ms) : null;

      if (TERMINAL_COMPLETED_EVENTS.has(eventType)) {
        const assistantContent = typeof event.output === "string"
          ? event.output
          : typeof event.output?.message?.content === "string"
            ? event.output.message.content
            : tracker?.lastPartialOutput || "";
        return dependencies.completeTerminal(run, {
          status: "completed",
          assistantContent,
          usage: event.usage,
          durationMs,
        }, upstreamRunId);
      }

      if (eventType === "run.failed" || eventType === "run.error") {
        const upstreamError = event.error || event.message || event.error_code || "RUN_FAILED_UPSTREAM";
        if (!tracker?.lastPartialOutput && isStreamingDecoderCompatError(upstreamError)) {
          dependencies.requestReconcile();
          return false;
        }
        return dependencies.completeTerminal(run, {
          status: "failed",
          errorCode: String(upstreamError),
          usage: event.usage,
          durationMs,
        }, upstreamRunId);
      }

      if (eventType === "run.cancelled" || eventType === "run.canceled") {
        return dependencies.completeTerminal(run, {
          status: "cancelled",
          errorCode: "CANCELLED_UPSTREAM",
          usage: event.usage,
          durationMs,
        }, upstreamRunId);
      }
      return false;
    }

    function scheduleTerminal(
      run: RuntimeRunEventTarget,
      event: Record<string, any>,
      upstreamRunId: string,
      failureLabel: string,
    ): void {
      void completeTerminalEvent(run, event, upstreamRunId).catch((error) => {
        dependencies.warn(
          `[RunsReconciler] ${failureLabel} for run ${run.id}:`,
          error instanceof Error ? error.message : "unknown",
        );
        dependencies.requestReconcile();
      });
    }

    function handle(run: RuntimeRunEventTarget, rawEvent: unknown, upstreamRunId?: string): void {
      if (!rawEvent || typeof rawEvent !== "object") return;
      const event = rawEvent as Record<string, any>;
      const tracker = getOrCreate(run.id, run.partial_output);
      const eventType = String(event.event || event.type || "");
      const resolvedUpstreamRunId = upstreamRunId ?? String(event.run_id || "");

      if (eventType === "message.delta" && typeof event.delta === "string" && event.delta) {
        const nextOutput = tracker.lastPartialOutput + event.delta;
        if (containsDsmlToolCallProtocol(nextOutput)) {
          dependencies.addEvent(
            run.id,
            "status",
            JSON.stringify({ status: "failed", errorCode: DSML_TOOL_CALL_ERROR_CODE }),
          );
          return;
        }
        tracker.lastPartialOutput = nextOutput;
        dependencies.addEvent(run.id, "text", event.delta);
        return;
      }

      if (["run.created", "run.queued"].includes(eventType)) {
        emitStep(run.id, tracker, {
          id: `${run.id}-task_received`,
          stepType: "model_reasoning",
          status: "completed",
          title: "Task received",
          timestamp: event.timestamp,
        });
        return;
      }

      if (["run.started", "run.in_progress", "run.running"].includes(eventType)) {
        emitStep(run.id, tracker, {
          id: `${run.id}-model-reasoning`,
          stepType: "model_reasoning",
          status: "running",
          title: "Analyzing task context",
          timestamp: event.timestamp,
        });
        return;
      }

      if (TERMINAL_COMPLETED_EVENTS.has(eventType)) {
        scheduleTerminal(run, event, resolvedUpstreamRunId, "Immediate completion failed");
        return;
      }

      if (TERMINAL_OTHER_EVENTS.has(eventType)) {
        scheduleTerminal(run, event, resolvedUpstreamRunId, "Immediate terminal handling failed");
        return;
      }

      if (eventType === "tool.started" || eventType === "tool.start") {
        const tool = String(event.tool || event.name || event.tool_name || "other");
        const id = `step-${dependencies.randomUUID()}`;
        const queue = tracker.activeToolIds.get(tool) || [];
        queue.push(id);
        tracker.activeToolIds.set(tool, queue);
        emitStep(run.id, tracker, {
          id,
          name: tool,
          tool,
          status: "running",
          title: event.title,
          startedAt: event.started_at || event.timestamp,
          query: event.query,
          count: event.count,
          source: event.source || event.provider,
        });
        return;
      }

      if (eventType === "tool.completed" || eventType === "tool.complete") {
        const tool = String(event.tool || event.name || event.tool_name || "other");
        const queue = tracker.activeToolIds.get(tool) || [];
        const id = queue.shift() || `step-${dependencies.randomUUID()}`;
        tracker.activeToolIds.set(tool, queue);
        emitStep(run.id, tracker, {
          id,
          name: tool,
          tool,
          status: event.error === true ? "failed" : "completed",
          title: event.title,
          completedAt: event.completed_at || event.timestamp,
          count: event.count || event.result_count || event.results_count,
          source: event.source || event.provider,
        });
        return;
      }

      if (["step", "step.started", "step.completed", "step.failed"].includes(eventType)) {
        emitStep(run.id, tracker, {
          ...event,
          status: event.status
            || (eventType === "step.completed" ? "completed" : eventType === "step.failed" ? "failed" : "running"),
        });
        return;
      }

      if (eventType === "approval.request") {
        const approval = sanitizeApprovalEvent(event, "pending");
        tracker.sentSteps.set(`interaction:approval:${approval.id}`, "pending");
        dependencies.addEvent(run.id, "approval", JSON.stringify(approval));
        dependencies.addEvent(run.id, "status", JSON.stringify({ status: "waiting_for_approval" }));
        return;
      }

      if (eventType === "approval.responded" || eventType === "approval.response") {
        const approval = sanitizeApprovalEvent(event, "resolved");
        tracker.sentSteps.set(`interaction:approval:${approval.id}`, "resolved");
        dependencies.addEvent(run.id, "approval", JSON.stringify(approval));
        dependencies.addEvent(run.id, "status", JSON.stringify({ status: "running" }));
      }
    }

    return {
      get: (runId) => trackers.get(runId),
      getOrCreate,
      clear: (runId) => trackers.delete(runId),
      emitStep,
      handle,
      completeTerminalEvent,
    };
  }
}

export const hermesRunEventProvider = Object.freeze(new HermesRunEventProvider());
