import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeLocalDatabase, mutateStoreCollections } from '../localStore';
import { beginA2ATaskLink, getA2ATaskLink, updateA2ATaskLink } from './a2aTaskLinks';
import { createChatGroupRun } from '../../shared/chatCollaboration';
import { reconcileA2AGroupCancellations } from './a2aGroupCancellation';
import { cancelA2ATask } from './a2aTaskCancel';
import { dbAdapter } from '../db';

const cancelManaged = vi.hoisted(() => vi.fn());
vi.mock('./managedRuntimeA2A', () => ({
  isManagedRuntimeA2APeer: (peer: any) => peer.runtime_type === 'pi',
  cancelManagedRuntimeA2ATask: cancelManaged,
}));

let root: string;
const previous = process.env.LOCAL_STORE_PATH;
const group = createChatGroupRun({ runId: 'parent', leader: { id: 'caller', name: 'Host' }, peers: [{ id: 'peer', name: 'Member' }], maxRounds: 1 })!;
const input = { instanceId: 'caller', peerId: 'peer', contextId: group.contextId, callerTaskId: 'task-one', fingerprint: 'same' };
beforeEach(() => {
  cancelManaged.mockReset();
  closeLocalDatabase(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybay-group-cancel-')); process.env.LOCAL_STORE_PATH = path.join(root, 'store.sqlite');
  mutateStoreCollections(['chatRuns'], store => store.chatRuns.push({ id: 'parent', instance_id: 'caller', status: 'running', group_collaboration: group }));
  beginA2ATaskLink(input);
  mutateStoreCollections(['chatRuns'], store => Object.assign(store.chatRuns[0], { status: 'cancelled', stop_requested_at: new Date().toISOString() }));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
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

it('routes late Pi mappings through managed cancellation and retains the verified remote terminal', async () => {
  vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'true'); vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', 'caller');
  const caller = { id: 'caller', user_id: 'owner', config_json: { a2aEnabled: true, a2aPeerIds: ['peer'] } };
  const peer = { id: 'peer', user_id: 'owner', runtime_type: 'pi', config_json: {} };
  vi.spyOn(dbAdapter, 'getInstanceById').mockImplementation(async id => id === 'caller' ? caller : peer);
  cancelManaged.mockResolvedValue({ id: 'remote', contextId: group.contextId, status: { state: 'TASK_STATE_CANCELED' } });
  await reconcileA2AGroupCancellations();
  expect(cancelManaged).not.toHaveBeenCalled();
  updateA2ATaskLink(read().id, { remoteTaskId: 'remote', state: 'mapped' });
  closeLocalDatabase();
  await reconcileA2AGroupCancellations();
  expect(cancelManaged).toHaveBeenCalledWith(peer, group.contextId, 'remote');
  expect(read()).toMatchObject({ state: 'finished', cancelState: 'confirmed', remoteState: 'TASK_STATE_CANCELED' });
});

it.each(['different-owner', 'tracking-disabled'])('does not bypass %s when cancelling a managed peer', async reason => {
  vi.stubEnv('MYBAY_A2A_TASK_TRACKING', reason === 'tracking-disabled' ? 'false' : 'true');
  vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', 'caller');
  const caller = { id: 'caller', user_id: 'owner', config_json: { a2aEnabled: true, a2aPeerIds: ['peer'] } };
  const peer = { id: 'peer', user_id: reason === 'different-owner' ? 'other' : 'owner', runtime_type: 'pi', config_json: {} };
  vi.spyOn(dbAdapter, 'getInstanceById').mockImplementation(async id => id === 'caller' ? caller : peer);
  updateA2ATaskLink(read().id, { remoteTaskId: 'remote', state: 'mapped' });
  await reconcileA2AGroupCancellations();
  expect(cancelManaged).not.toHaveBeenCalled();
  expect(read()).toMatchObject({ state: 'mapped', cancelState: 'unconfirmed' });
});
