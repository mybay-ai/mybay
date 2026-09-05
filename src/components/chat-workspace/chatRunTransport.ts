import type { A2ARecoverySource } from "../../../shared/a2aRecovery";
import { api } from "../../lib/api";
import type { ChatReasoningEffort } from "./ChatInputBar";
import { isConcurrencyTakeoverError, isRetryableRunCreationError } from "./chatMessagePolicy";
import { sleep } from "./chatWorkspaceSendPolicy";
import { pollRunRelease, type RunReleaseResult } from "./run/runStopLifecycle";

export async function waitForRunRelease(instanceId: string, runId: string): Promise<RunReleaseResult> {
  return pollRunRelease({
    delay: async milliseconds => { await sleep(milliseconds); },
    readStatus: async () => {
      const response = await api.get(`/api/instances/${instanceId}/runs/${runId}`);
      return response?.run?.status;
    },
  });
}

export async function createChatRunWithRetry(
  instanceId: string,
  payload: {
    conversationId: string | null;
    a2aRecoverySource?: A2ARecoverySource;
    content: string;
    requestId: string;
    reasoningEffort?: ChatReasoningEffort;
    attachmentIds?: string[];
  },
  shouldRetryConcurrency: boolean,
  isContextCurrent: () => boolean = () => true,
) {
  let concurrencyRetries = 0;
  let transientRetries = 0;
  while (true) {
    if (!isContextCurrent()) {
      throw new DOMException("Chat request context changed", "AbortError");
    }
    try {
      return await api.post(`/api/instances/${instanceId}/runs`, payload);
    } catch (error: any) {
      if (shouldRetryConcurrency && isConcurrencyTakeoverError(error) && concurrencyRetries < 5) {
        const delayMs = 300 + concurrencyRetries * 250;
        concurrencyRetries += 1;
        await sleep(delayMs);
        continue;
      }
      if (isRetryableRunCreationError(error) && transientRetries < 1) {
        transientRetries += 1;
        await sleep(400);
        continue;
      }
      throw error;
    }
  }
}
