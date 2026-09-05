import { describe, expect, it } from 'vitest';
import { selectA2ATaskLinksForRefresh, type A2ATaskLink } from './a2aTaskLinks';

const base: A2ATaskLink = {
  id: 'link-1', instanceId: 'caller', peerId: 'peer-1', contextId: 'ctx-1', callerTaskId: 'task-1',
  fingerprint: 'fingerprint', remoteTaskId: 'remote-1', state: 'mapped',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const visible = (row: A2ATaskLink) => `${row.peerId}\n${row.callerTaskId}\n${row.contextId}`;

describe('A2A task-link refresh selection', () => {
  it('selects only visible, trusted, stale, unfinished mappings for the current instance', () => {
    const rows: A2ATaskLink[] = [
      base,
      { ...base, id: 'finished', callerTaskId: 'finished', state: 'finished' },
      { ...base, id: 'fresh', callerTaskId: 'fresh', checkedAt: '2026-01-01T00:00:09.000Z' },
      { ...base, id: 'foreign-peer', callerTaskId: 'foreign-peer', peerId: 'peer-2' },
      { ...base, id: 'foreign-instance', callerTaskId: 'foreign-instance', instanceId: 'other' },
      { ...base, id: 'unmapped', callerTaskId: 'unmapped', remoteTaskId: undefined },
    ];
    const selected = selectA2ATaskLinksForRefresh({
      links: rows,
      instanceId: 'caller',
      trustedPeerIds: new Set(['peer-1']),
      visibleTasks: new Set(rows.map(visible)),
      refreshBefore: new Date('2026-01-01T00:00:05.000Z').getTime(),
    });
    expect(selected.map(row => row.id)).toEqual(['link-1']);
  });

  it('keeps automatic reconciliation bounded', () => {
    const links = Array.from({ length: 12 }, (_, index): A2ATaskLink => ({ ...base, id: `link-${index}`, callerTaskId: `task-${index}` }));
    expect(selectA2ATaskLinksForRefresh({
      links,
      instanceId: 'caller',
      trustedPeerIds: new Set(['peer-1']),
      visibleTasks: new Set(links.map(visible)),
      refreshBefore: Date.now(),
    })).toHaveLength(3);
  });
});
