import { expect, it } from 'vitest';
import { createChatGroupRun } from './chatCollaboration';
import { resolveChatGroupOutcome } from './chatGroupOutcome';
const group = createChatGroupRun({ runId: 'run', leader: { id: 'host', name: 'Host' }, peers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], maxRounds: 2 });
const run = { id: 'run', status: 'completed', group_collaboration: group };
const call = (peerId: string, remoteState = 'TASK_STATE_COMPLETED') => ({ parentRunId: 'run', peerId, state: 'finished', remoteState });
it('does not infer group success from host completion, missing members or an unrelated result', () => {
  expect(resolveChatGroupOutcome(run, [call('a'), { ...call('b'), parentRunId: 'other' }])).toBe('unknown');
  expect(resolveChatGroupOutcome(run, [call('a'), call('b')])).toBe('completed');
  expect(resolveChatGroupOutcome(run, [call('a', 'TASK_STATE_CANCELED'), call('b', 'TASK_STATE_CANCELED')])).toBe('cancelled');
  expect(resolveChatGroupOutcome(run, [call('a'), { ...call('b'), lookupState: 'not_found' }])).toBe('unknown');
});
it('preserves an earlier failure and excludes explicitly unselected members from expectations', () => {
  expect(resolveChatGroupOutcome(run, [call('a', 'TASK_STATE_FAILED'), call('a'), call('b')])).toBe('partial');
  expect(resolveChatGroupOutcome({ ...run, group_collaboration: { ...group, selectedPeerIds: ['a'] } }, [call('a', 'TASK_STATE_AUTH_REQUIRED')])).toBe('failed');
  expect(resolveChatGroupOutcome({ ...run, group_collaboration: { ...group, selectedPeerIds: ['a'] } }, [call('a')])).toBe('completed');
});
