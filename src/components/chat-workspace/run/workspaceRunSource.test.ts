import { describe, expect, it } from 'vitest';
import { createLocalRunTimeline } from '../../../../shared/localRunTimeline';
import { resolveWorkspaceRunSource } from './workspaceRunSource';
import { createRunExecutionState } from './runReducer';
import { resolveToolDisplayStatus } from './runStatusSemantics';

const message = {
  id: 'm', role: 'assistant' as const, content: 'Final.', conversation_id: 'c', usage_total_tokens: 123,
  metadata: { run_id: 'r', run_timeline: createLocalRunTimeline({ runId: 'r', conversationId: 'c', status: 'completed', events: [
    { id: 1, event: 'step', data: JSON.stringify({ id: 'a', tool_name: 'terminal', status: 'completed' }) },
    { id: 2, event: 'step', data: JSON.stringify({ id: 'b', tool_name: 'terminal', status: 'running' }) },
    { id: 3, event: 'text', data: 'Final.' },
  ] }) },
};
describe('workspace run identity and history', () => {
  it('restores historical steps and usage without counting inferred outcomes as successes', () => {
    const source = resolveWorkspaceRunSource({ messages: [message], conversationId: 'c', toolSteps: [], metrics: { runId: 'other', usageTotalTokens: 999 } });
    expect(source.result.runId).toBe('r');
    expect(source.metrics.usageTotalTokens).toBe(123);
    expect(source.execution?.status).toBe('completed');
    expect(source.toolSteps).toHaveLength(2);
    expect(source.toolSteps.map(step => resolveToolDisplayStatus(step.status, 'completed', step.completionInferred))).toEqual(['completed', 'unknown']);
  });
  it('does not borrow the previous result or metrics while a new run is queued', () => {
    const source = resolveWorkspaceRunSource({ messages: [message], conversationId: 'c', activeRunId: 'new', toolSteps: [], metrics: { runId: 'r', usageTotalTokens: 123 } });
    expect(source.result.content).toBe('');
    expect(source.execution).toBeNull();
    expect(source.metrics.usageTotalTokens).toBeNull();
    expect(source.toolSteps).toEqual([]);
  });
  it('prefers the matching live run and never imports another conversation', () => {
    const execution = createRunExecutionState({ runId: 'new', conversationId: 'c', initialText: 'Live' });
    const source = resolveWorkspaceRunSource({ messages: [message], conversationId: 'c', activeRunId: 'new', execution, toolSteps: [], metrics: { runId: 'new', usageTotalTokens: 42 } });
    expect(source.result.content).toBe('Live');
    expect(source.metrics.usageTotalTokens).toBe(42);
    expect(resolveWorkspaceRunSource({ messages: [message], conversationId: 'other', execution, toolSteps: [] }).result.content).toBe('');
  });
  it('keeps a stopped empty answer instead of showing the previous completed result', () => {
    const stopped = { id: 'stopped', role: 'assistant' as const, content: '', status: 'stopped' as const, conversation_id: 'c', metadata: { run_id: 'stopped-run' } };
    const source = resolveWorkspaceRunSource({ messages: [message, stopped], conversationId: 'c', toolSteps: [] });
    expect(source.result.runId).toBe('stopped-run');
    expect(source.result.content).toBe('');
    expect(source.metrics.status).toBe('stopped');
  });
});
