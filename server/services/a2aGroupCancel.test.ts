import { beforeEach, expect, it, vi } from 'vitest';
import { mutateStoreCollections } from '../localStore';
import { beginA2ATaskLink, updateA2ATaskLink } from './a2aTaskLinks';
import { cancelMappedA2AGroupTasks } from './a2aTaskCancel';

beforeEach(() => mutateStoreCollections(['a2aTaskLinks'], store => { store.a2aTaskLinks = []; }));

function mapped(peerId: string, contextId = 'ctx-room') {
  const link = beginA2ATaskLink({ instanceId: 'host', peerId, contextId, callerTaskId: `caller-${peerId}`, fingerprint: peerId }).link;
  return updateA2ATaskLink(link.id, { remoteTaskId: `remote-${peerId}`, remoteState: 'TASK_STATE_WORKING', state: 'mapped' });
}

it('cancels every mapped unfinished task in the exact room and reports confirmations', async () => {
  const first = mapped('peer-1');
  const second = mapped('peer-2');
  const unrelated = mapped('peer-3', 'ctx-other');
  const send = vi.fn(async (peerId: string, remoteTaskId: string) => ({ id: remoteTaskId, contextId: 'ctx-room', status: { state: peerId === 'peer-2' ? 'TASK_STATE_WORKING' : 'TASK_STATE_CANCELED' } }));
  const result = await cancelMappedA2AGroupTasks({ links: [first, second, unrelated], instanceId: 'host', contextId: 'ctx-room', peerIds: ['peer-1', 'peer-2'], send });
  expect(result).toEqual({ attempted: 2, confirmed: 1, unconfirmed: 1 });
  expect(send.mock.calls.map(call => call.slice(0, 2))).toEqual([['peer-1', 'remote-peer-1'], ['peer-2', 'remote-peer-2']]);
});
