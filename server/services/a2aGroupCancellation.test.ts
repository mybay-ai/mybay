import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeLocalDatabase, mutateStoreCollections } from '../localStore';
import { beginA2ATaskLink, getA2ATaskLink, updateA2ATaskLink } from './a2aTaskLinks';
import { createChatGroupRun } from '../../shared/chatCollaboration';
import { reconcileA2AGroupCancellations } from './a2aGroupCancellation';
import { cancelA2ATask } from './a2aTaskCancel';

let root: string;
const previous = process.env.LOCAL_STORE_PATH;
const group = createChatGroupRun({ runId: 'parent', leader: { id: 'caller', name: 'Host' }, peers: [{ id: 'peer', name: 'Member' }], maxRounds: 1 })!;
const input = { instanceId: 'caller', peerId: 'peer', contextId: group.contextId, callerTaskId: 'task-one', fingerprint: 'same' };
beforeEach(() => {
  closeLocalDatabase(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybay-group-cancel-')); process.env.LOCAL_STORE_PATH = path.join(root, 'store.sqlite');
  mutateStoreCollections(['chatRuns'], store => store.chatRuns.push({ id: 'parent', instance_id: 'caller', status: 'running', group_collaboration: group }));
  beginA2ATaskLink(input);
  mutateStoreCollections(['chatRuns'], store => Object.assign(store.chatRuns[0], { status: 'cancelled', stop_requested_at: new Date().toISOString() }));
});
afterEach(() => {
  closeLocalDatabase(); if (previous === undefined) delete process.env.LOCAL_STORE_PATH; else process.env.LOCAL_STORE_PATH = previous;
  fs.rmSync(root, { recursive: true, force: true });
});
const read = () => getA2ATaskLink('caller', 'peer', 'task-one')!;
it('cancels a late remote mapping after parent termination and database reopen, retaining the confirmed terminal state', async () => {
  const cancel = vi.fn(async link => cancelA2ATask(link, async id => ({ id, contextId: group.contextId, status: { state: 'TASK_STATE_CANCELED' } })));
  await reconcileA2AGroupCancellations(cancel);
  expect(cancel).not.toHaveBeenCalled(); expect(read().cancelState).toBe('unconfirmed');
  updateA2ATaskLink(read().id, { remoteTaskId: 'remote', remoteState: 'TASK_STATE_WORKING', state: 'mapped' });
  closeLocalDatabase(); await reconcileA2AGroupCancellations(cancel);
  expect(read()).toMatchObject({ state: 'finished', cancelState: 'confirmed', remoteState: 'TASK_STATE_CANCELED' });
  updateA2ATaskLink(read().id, { state: 'finished', task: { status: { state: 'TASK_STATE_COMPLETED' } }, remoteState: 'TASK_STATE_COMPLETED' });
  expect(read().remoteState).toBe('TASK_STATE_CANCELED');
  await reconcileA2AGroupCancellations(cancel); expect(cancel).toHaveBeenCalledTimes(1);
});
it('bounds failed cancellation retries and never reports them as a confirmed stop', async () => {
  updateA2ATaskLink(read().id, { remoteTaskId: 'remote', state: 'mapped' });
  const cancel = vi.fn(async () => { throw Error('offline'); });
  for (let i = 0; i < 5; i++) await reconcileA2AGroupCancellations(cancel);
  expect(cancel).toHaveBeenCalledTimes(3);
  expect(read()).toMatchObject({ state: 'mapped', cancelState: 'unconfirmed', cancelAttempts: 3 });
});
