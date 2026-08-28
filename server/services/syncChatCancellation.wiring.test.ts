import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readSource = (relativePath: string) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

describe("synchronous chat cancellation wiring", () => {
  const quickSource = readSource("server/routes/instances/chat/quick.routes.ts");
  const assistSource = readSource("server/routes/instances/chat/assist.routes.ts");
  const llmSource = readSource("server/utils/llmClient.ts");
  const workspaceSource = [
    readSource("src/components/ChatWorkspace.tsx"),
    readSource("src/components/ChatWorkspaceMessageSender.ts"),
    readSource("src/components/chat-workspace/chatCancellationController.ts"),
  ].join("\n");

  it.each([
    ["quick", quickSource],
    ["assist", assistSource]
  ])("connects %s chat to cancellation ownership", (_mode, source) => {
    expect(source).toContain("createSyncChatRequestLifecycle(req, res)");
    expect(source).toContain("signal: syncLifecycle.signal");
    expect(source).toContain("syncLifecycle.throwIfCancelled()");
    expect(source).toContain('errorCode: cancelledByUser ? "CANCELLED_BY_USER"');
    expect(source).toContain("syncLifecycle.cleanup()");
  });

  it("propagates an external abort signal through the LLM client", () => {
    expect(llmSource).toContain("signal?: AbortSignal");
    expect(llmSource).toContain('options.signal?.addEventListener("abort", abortFromExternalSignal');
    expect(llmSource).toContain('options.signal?.removeEventListener("abort", abortFromExternalSignal)');
  });

  it("aborts Quick/Assist from the stop button and schedules authoritative reconciliation", () => {
    expect(workspaceSource).toContain('const syncController = chatMode === "agent" ? null : new AbortController()');
    expect(workspaceSource.match(/signal: syncController!\.signal/g)).toHaveLength(2);
    expect(workspaceSource).toContain("syncRequest.controller.abort()");
    expect(workspaceSource).toContain("scheduleSyncCancellationReconciliation(syncRequest.instanceId, syncRequest.conversationId)");
    expect(workspaceSource).toContain("onStopRun={handleCancelOrStop}");
  });
});
