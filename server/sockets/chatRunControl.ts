import type { Server as SocketIOServer, Socket } from "socket.io";

import { dbAdapter } from "../db";
import { chatRepo } from "../repositories/chatRepo";
import { resolveInstanceAuthority, resolveInstanceRunAuthority } from "../services/instances/resourceAuthorityService";
import { requestRunsReconcile } from "../services/runsReconciler";
import { isValidInstanceId, isValidUUID } from "../routes/instances/chat/validators";

export const CHAT_RUN_STOP_CONTROL_EVENT = "chat_workspace:stop_run";

type StopControlPayload = { instanceId?: unknown; runId?: unknown };
type StopControlResponse = {
  success: boolean;
  status?: string;
  error?: string;
};

type StopControlDependencies = {
  getUserById: (userId: string) => Promise<any>;
  resolveInstance: typeof resolveInstanceAuthority;
  resolveRun: typeof resolveInstanceRunAuthority;
  requestStop: typeof chatRepo.requestStopChatRun;
  requestReconcile: () => void;
};

const defaultDependencies: StopControlDependencies = {
  getUserById: (userId) => dbAdapter.getUserById(userId),
  resolveInstance: resolveInstanceAuthority,
  resolveRun: resolveInstanceRunAuthority,
  requestStop: (params) => chatRepo.requestStopChatRun(params),
  requestReconcile: requestRunsReconcile,
};

export async function handleChatRunStopControl(
  userId: string,
  payload: StopControlPayload,
  dependencies: StopControlDependencies = defaultDependencies,
): Promise<StopControlResponse> {
  const instanceId = String(payload?.instanceId || "");
  const runId = String(payload?.runId || "");
  if (!isValidInstanceId(instanceId) || !isValidUUID(runId)) {
    return { success: false, error: "INVALID_REQUEST" };
  }

  const user = await dependencies.getUserById(userId);
  if (!user || user.status === "disabled") return { success: false, error: "UNAUTHORIZED" };

  const instance = await dependencies.resolveInstance({ actor: { kind: "user", id: userId }, instanceId });
  if (instance.ok === false) return { success: false, error: instance.code };
  const run = await dependencies.resolveRun({ instance, runId });
  if (run.ok === false) return { success: false, error: run.code };

  const result = await dependencies.requestStop({ runId, userId, instanceId });
  if (result.status === "stop_requested" || result.status === "already_stopping") {
    dependencies.requestReconcile();
    return { success: true, status: "stopping" };
  }
  if (result.status === "already_terminal") {
    return { success: true, status: String(result.run_status || "completed") };
  }
  return { success: false, error: result.status === "invalid_state" ? "INVALID_STATE" : "RUN_STOP_FAILED" };
}

export function setupChatRunControl(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(CHAT_RUN_STOP_CONTROL_EVENT, async (payload: StopControlPayload, acknowledge?: (response: StopControlResponse) => void) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => undefined;
      try {
        const userId = String((socket as any).user?.id || "");
        if (!userId) return respond({ success: false, error: "UNAUTHORIZED" });
        respond(await handleChatRunStopControl(userId, payload));
      } catch (error) {
        console.error("[Chat Run Socket Stop Error]", error);
        respond({ success: false, error: "INTERNAL_ERROR" });
      }
    });
  });
}
