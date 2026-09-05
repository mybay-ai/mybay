import type { ChatMessage } from '../../../lib/chatWorkspaceState';
import type { ChatRunMetrics } from '../useChatRuns';
import type { ChatToolStep } from '../ChatToolProgress';
import { readLocalRunUsage, usageNumber } from '../../../../shared/localRunUsage';
import { resolveWorkspaceAssistantResult } from './runResultSource';
import { selectMessageTimeline } from './runTimelinePresentation';
import { deriveToolSteps } from './runReducer';
import type { RunExecutionState } from './runTypes';

export function resolveWorkspaceRunSource(args: {
  messages: ChatMessage[];
  conversationId: string | null;
  activeRunId?: string | null;
  execution?: RunExecutionState | null;
  metrics?: ChatRunMetrics | null;
  toolSteps: ChatToolStep[];
}) {
  const live = args.execution?.conversationId === args.conversationId ? args.execution : null;
  const messages = args.messages.filter(message => message.conversation_id === args.conversationId);
  const result = resolveWorkspaceAssistantResult(messages, live, args.activeRunId);
  const execution = result.live ? live : result.message
    ? selectMessageTimeline(result.message, args.conversationId, live?.runId === result.runId ? live : null)
    : null;
  const usage = readLocalRunUsage(result.message?.metadata?.usage_evidence);
  const metrics: ChatRunMetrics = args.metrics?.runId && args.metrics.runId === result.runId ? args.metrics : {
    runId: result.runId,
    status: execution?.status ?? result.message?.status,
    usageTotalTokens: usage ? usage.totalTokens : usageNumber(result.message?.usage_total_tokens),
    durationMs: usage?.durationMs,
  };
  // The same projected tool set as the inline timeline. Preserve inferred outcomes.
  const blocks = execution?.blocks.filter(block => block.type === 'tool' && block.stepType !== 'final' && block.stepType !== 'model_reasoning');
  const toolSteps = blocks ? deriveToolSteps(blocks).map((step, index) => ({
    ...step, completionInferred: blocks[index].type === 'tool' && blocks[index].completionInferred,
  })) : args.activeRunId && result.runId === args.activeRunId ? args.toolSteps : [];
  return { result, execution, metrics, toolSteps };
}
