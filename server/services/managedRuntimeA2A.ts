import { requestRunsAPI } from "./runsReconciler";
import { runtimeRegistry } from "../runtime/runtimeRegistry";

const POLL_INTERVAL_MS = 500;
const MAX_WAIT_MS = 180_000;

function runtimeType(instance: any): string {
  return String(instance?.runtime_type || "hermes").trim().toLowerCase();
}

export function isManagedRuntimeA2APeer(instance: any): boolean {
  if (!isManagedRuntimeA2ACaller(instance) || String(instance?.status || "").toLowerCase() !== "running") return false;
  return true;
}

export function isManagedRuntimeA2ACaller(instance: any): boolean {
  if (runtimeType(instance) !== "pi") return false;
  try {
    runtimeRegistry.resolveRunBinding(instance);
    return true;
  } catch {
    return false;
  }
}

export async function probeManagedRuntimeA2ACaller(instance: any) {
  if (!isManagedRuntimeA2APeer(instance)) return { state: "disabled" as const, toolState: "unknown" as const };
  try {
    const response = await runtimeRequest(instance, "GET", "/v1/capabilities", undefined, 5_000);
    const ready = response.ok && response.json?.features?.run_submission === true;
    return ready
      ? { state: "ready" as const, runtime: "pi", transport: "mybay_runtime" as const, toolState: response.json?.features?.a2a_tools === true ? "ready" as const : "unavailable" as const }
      : { state: "unavailable" as const, runtime: "pi", transport: "mybay_runtime" as const, toolState: "unavailable" as const };
  } catch {
    return { state: "unavailable" as const, runtime: "pi", transport: "mybay_runtime" as const, toolState: "unavailable" as const };
  }
}

export function isNativeA2APeer(instance: any, config: any, supportsNative: boolean): boolean {
  return supportsNative && config?.a2aEnabled === true;
}

export async function probeManagedRuntimeA2APeer(instance: any) {
  if (!isManagedRuntimeA2APeer(instance)) return { state: "disabled" as const };
  try {
    const response = await runtimeRequest(instance, "GET", "/v1/capabilities", undefined, 5_000);
    return response.ok && response.json?.features?.run_submission === true
      ? { state: "ready" as const, runtime: "pi", transport: "mybay_runtime" as const }
      : { state: "unavailable" as const, runtime: "pi", transport: "mybay_runtime" as const };
  } catch {
    return { state: "unavailable" as const, runtime: "pi", transport: "mybay_runtime" as const };
  }
}

function messageText(message: any): string {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts.filter((part: any) => typeof part?.text === "string").map((part: any) => part.text).join("\n").trim();
}

function taskState(status: unknown): string {
  switch (String(status || "").toLowerCase()) {
    case "queued": return "TASK_STATE_SUBMITTED";
    case "running": return "TASK_STATE_WORKING";
    case "completed": return "TASK_STATE_COMPLETED";
    case "cancelled":
    case "canceled": return "TASK_STATE_CANCELED";
    case "failed": return "TASK_STATE_FAILED";
    default: return "TASK_STATE_UNKNOWN";
  }
}

function toA2ATask(run: any, contextId: string) {
  const output = typeof run?.output === "string" ? run.output.trim() : "";
  return {
    id: String(run?.id || run?.run_id || ""),
    contextId,
    status: {
      state: taskState(run?.status),
      ...(run?.error ? { message: { role: "agent", parts: [{ kind: "text", text: String(run.error) }] } } : {}),
    },
    ...(output ? { artifacts: [{ artifactId: "reply", name: "Pi Agent response", parts: [{ kind: "text", text: output }] }] } : {}),
  };
}

async function runtimeRequest(peer: any, method: string, path: string, body?: unknown, timeoutMs = 10_000) {
  return requestRunsAPI({ instanceId: String(peer.id), method, path, body, timeoutMs }, peer);
}

export async function readManagedRuntimeA2ATask(peer: any, contextId: string, remoteId: string) {
  const response = await runtimeRequest(peer, "GET", `/v1/runs/${encodeURIComponent(remoteId)}`);
  if (!response.ok || !response.json) throw Error(response.statusCode === 404 ? "A2A_TASK_NOT_FOUND" : "A2A_RESULT_UNAVAILABLE");
  return toA2ATask(response.json, contextId);
}

export async function cancelManagedRuntimeA2ATask(peer: any, contextId: string, remoteId: string) {
  const stopped = await runtimeRequest(peer, "POST", `/v1/runs/${encodeURIComponent(remoteId)}/stop`, undefined, 5_000);
  if (!stopped.ok) throw Error("A2A_CANCEL_UNCONFIRMED");
  const deadline = Date.now() + 5_000;
  let task = toA2ATask(stopped.json, contextId);
  while (task.status.state !== "TASK_STATE_CANCELED" && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 150));
    task = await readManagedRuntimeA2ATask(peer, contextId, remoteId);
  }
  if (task.status.state !== "TASK_STATE_CANCELED") throw Error("A2A_CANCEL_UNCONFIRMED");
  return task;
}

export function sendManagedRuntimeA2A(peer: any, request: any): Promise<Response> {
  const contextId = String(request?.params?.message?.contextId || "");
  const input = messageText(request?.params?.message);
  if (!input) throw Error("A2A_INVALID_REQUEST");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (result: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n\n`));
      try {
        const session = await runtimeRequest(peer, "POST", "/api/sessions", { title: `MyBay collaboration ${contextId}` });
        const sessionId = String(session.json?.id || "");
        if (!session.ok || !/^[A-Za-z0-9_.:-]{8,160}$/.test(sessionId)) throw Error("A2A_RUNTIME_SESSION_FAILED");
        const submitted = await runtimeRequest(peer, "POST", "/v1/runs", {
          input,
          instructions: "You are a member of a MyBay multi-Agent collaboration room. Complete only the delegated task, return concrete findings or artifacts, and do not delegate further.",
          session_id: sessionId,
          model_options: { reasoning_effort: "medium" },
        });
        let task = toA2ATask(submitted.json, contextId);
        if (!submitted.ok || !task.id) throw Error("A2A_RUNTIME_DISPATCH_FAILED");
        emit({ task });
        const deadline = Date.now() + MAX_WAIT_MS;
        while (!["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"].includes(task.status.state)) {
          if (Date.now() >= deadline) throw Error("A2A_RUNTIME_TIMEOUT");
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          task = await readManagedRuntimeA2ATask(peer, contextId, task.id);
        }
        if (task.artifacts?.length) {
          for (const artifact of task.artifacts) emit({ artifactUpdate: { taskId: task.id, contextId, artifact } });
        }
        emit({ statusUpdate: { taskId: task.id, contextId, status: task.status, final: true } });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }));
}
