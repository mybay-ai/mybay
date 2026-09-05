import { describe, expect, it } from 'vitest';
import { evaluateA2AGroupDispatch } from './a2aGroupDispatchPolicy';
import type { A2ATaskLink } from './a2aTaskLinks';

const room = { version: 1, mode: 'group', contextId: 'ctx-mybay-room-policy', leader: { id: 'host', name: 'Host' }, peers: [{ id: 'peer-1', name: 'One' }], maxRounds: 1 };
const link: A2ATaskLink = { id: 'link', instanceId: 'host', peerId: 'peer-1', contextId: room.contextId, callerTaskId: 'task-1', fingerprint: 'fp', state: 'mapped', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const evaluate = (peerId: string, callerTaskId: string, links: A2ATaskLink[] = []) => evaluateA2AGroupDispatch({ runs: [{ instance_id: 'host', group_collaboration: room }], links, instanceId: 'host', peerId, contextId: room.contextId, callerTaskId });

describe('A2A collaboration-room dispatch policy', () => {
  it('allows configured members up to the snapshotted round limit and keeps idempotent replay readable', () => {
    expect(evaluate('peer-1', 'task-1')).toMatchObject({ allowed: true, room: true });
    expect(evaluate('peer-1', 'task-1', [link])).toMatchObject({ allowed: true, room: true });
    expect(evaluate('peer-1', 'task-2', [link])).toEqual({ allowed: false, room: true, error: 'A2A_GROUP_ROUND_LIMIT' });
  });

  it('reattaches a new caller ID to an unfinished member task after control-plane recovery', () => {
    const unfinished = { ...link, state: 'uncertain' as const, remoteTaskId: 'remote-1' };
    expect(evaluate('peer-1', 'task-after-restart', [unfinished])).toMatchObject({
      allowed: true,
      room: true,
      resumeLink: unfinished,
    });
  });

  it('blocks room contexts from contacting members outside the run snapshot', () => {
    expect(evaluate('peer-2', 'task-2')).toEqual({ allowed: false, room: true, error: 'A2A_GROUP_MEMBER_NOT_ALLOWED' });
  });

  it('does not apply room limits to ordinary direct A2A contexts', () => {
    expect(evaluateA2AGroupDispatch({ runs: [], links: [link], instanceId: 'host', peerId: 'peer-1', contextId: 'ctx-direct', callerTaskId: 'task-2' })).toEqual({ allowed: true, room: false });
  });
});
