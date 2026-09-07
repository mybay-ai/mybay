import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeLocalDatabase, mutateStoreCollections } from '../localStore';
import { beginA2ATaskLink } from './a2aTaskLinks';
import { createChatGroupRun } from '../../shared/chatCollaboration';

let root: string;
const previous = process.env.LOCAL_STORE_PATH;
const group = createChatGroupRun({ runId: 'parent', leader: { id: 'caller', name: 'Host' }, peers: [{ id: 'peer', name: 'Member' }], maxRounds: 1 })!;
const input = { instanceId: 'caller', peerId: 'peer', contextId: group.contextId, callerTaskId: 'task-one', fingerprint: 'same' };
beforeEach(() => {
  closeLocalDatabase(); root = fs.mkdtempSync(path.join(os.tmpdir(), 'mybay-group-dispatch-'));
  process.env.LOCAL_STORE_PATH = path.join(root, 'store.sqlite');
  mutateStoreCollections(['chatRuns'], store => store.chatRuns.push({ id: 'parent', instance_id: 'caller', status: 'running', group_collaboration: group }));
});
afterEach(() => {
  closeLocalDatabase(); if (previous === undefined) delete process.env.LOCAL_STORE_PATH; else process.env.LOCAL_STORE_PATH = previous;
  fs.rmSync(root, { recursive: true, force: true });
});
it('persists exact parent attribution and budgets across reopen without charging replay twice', () => {
  expect(beginA2ATaskLink(input).link).toMatchObject({ parentRunId: 'parent', memberCallNumber: 1 });
  closeLocalDatabase();
  expect(beginA2ATaskLink(input).created).toBe(false);
  expect(() => beginA2ATaskLink({ ...input, callerTaskId: 'task-two' })).toThrow('A2A_GROUP_CALL_LIMIT');
});
it('rejects a room outsider, changed context, missing parent and recursive member delegation', () => {
  expect(() => beginA2ATaskLink({ ...input, peerId: 'outsider' })).toThrow('A2A_GROUP_PEER_FORBIDDEN');
  expect(() => beginA2ATaskLink({ ...input, contextId: 'ctx-fresh' })).toThrow('A2A_GROUP_CONTEXT_REQUIRED');
  expect(() => beginA2ATaskLink({ ...input, instanceId: 'other' })).toThrow('A2A_GROUP_PARENT_REQUIRED');
  beginA2ATaskLink(input);
  expect(() => beginA2ATaskLink({ ...input, instanceId: 'peer', peerId: 'caller', contextId: 'ctx-fresh' })).toThrow('A2A_GROUP_RECURSION_BLOCKED');
});
it.each(['stopping', 'cancelled', 'completed'])('rejects a new dispatch after the parent becomes %s', status => {
  mutateStoreCollections(['chatRuns'], store => { store.chatRuns[0].status = status; });
  expect(() => beginA2ATaskLink(input)).toThrow('A2A_GROUP_NOT_RUNNING');
});
