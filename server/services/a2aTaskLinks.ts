import crypto from 'node:crypto';
import { mutateStoreCollections, readStoreCollections } from '../localStore';
import { readChatGroupRun } from '../../shared/chatCollaboration';

export type A2ATaskLink = {
  parentRunId?: string;
  memberCallNumber?: number;
  cancelState?: 'pending' | 'confirmed' | 'unconfirmed';
  cancelAttempts?: number;
  cancelCheckedAt?: string;
  lookupState?: 'not_found' | 'unavailable' | 'disk_reply'; checkedAt?: string; diskResult?: string;
  id: string; instanceId: string; peerId: string; contextId: string; callerTaskId: string;
  fingerprint: string; remoteTaskId?: string; remoteState?: string; task?: any;
  state: 'submitted' | 'mapped' | 'finished' | 'uncertain'; createdAt: string; updatedAt: string;
};
export const linkKey = (instanceId: string, peerId: string, callerTaskId: string) => crypto.createHash('sha256').update(JSON.stringify([instanceId, peerId, callerTaskId])).digest('hex');
export function a2aTaskResultText(task: any): string {
  const parts = Array.isArray(task?.artifacts) ? task.artifacts.flatMap((artifact: any) => Array.isArray(artifact?.parts) ? artifact.parts : []) : [];
  const text = parts.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n');
  const fallback = Array.isArray(task?.status?.message?.parts) ? task.status.message.parts.filter((part: any) => typeof part?.text === 'string').map((part: any) => part.text).join('\n') : '';
  return (text || fallback).slice(0, 8000);
}
export function getA2ATaskLink(instanceId: string, peerId: string, callerTaskId: string): A2ATaskLink | undefined {
  return readStoreCollections(['a2aTaskLinks']).a2aTaskLinks.find(row => row.id === linkKey(instanceId, peerId, callerTaskId));
}
export function beginA2ATaskLink(input: Pick<A2ATaskLink, 'instanceId' | 'peerId' | 'contextId' | 'callerTaskId' | 'fingerprint'>) {
  return mutateStoreCollections(['a2aTaskLinks', 'chatRuns'], store => {
    const id = linkKey(input.instanceId, input.peerId, input.callerTaskId);
    const found = store.a2aTaskLinks.find(row => row.id === id) as A2ATaskLink | undefined;
    if (found) {
      if (found.fingerprint !== input.fingerprint || found.contextId !== input.contextId) throw Error('A2A_REQUEST_CONFLICT');
      return { created: false, link: found };
    }
    // Reserve the member budget in the same transaction as the dispatch record.
    // A caller cannot escape a live room by choosing a fresh context or task ID.
    const live = store.chatRuns.filter(run => run.instance_id === input.instanceId && ['queued', 'running', 'stopping'].includes(run.status) && readChatGroupRun(run.group_collaboration));
    const parent = store.chatRuns.find(run => run.instance_id === input.instanceId && readChatGroupRun(run.group_collaboration)?.contextId === input.contextId);
    const inboundGroup = store.a2aTaskLinks.some(link => link.peerId === input.instanceId && link.parentRunId && link.state !== 'finished');
    if (inboundGroup) throw Error('A2A_GROUP_RECURSION_BLOCKED');
    if (live.length && (live.length !== 1 || live[0].id !== parent?.id)) throw Error('A2A_GROUP_CONTEXT_REQUIRED');
    if (!parent && input.contextId.startsWith('ctx-mybay-room-')) throw Error('A2A_GROUP_PARENT_REQUIRED');
    let memberCallNumber: number | undefined;
    if (parent) {
      const group = readChatGroupRun(parent.group_collaboration)!;
      if (parent.status !== 'running' || parent.stop_requested_at) throw Error('A2A_GROUP_NOT_RUNNING');
      if (!group.selectedPeerIds?.includes(input.peerId)) throw Error('A2A_GROUP_PEER_FORBIDDEN');
      memberCallNumber = store.a2aTaskLinks.filter(link => link.parentRunId === parent.id && link.peerId === input.peerId).length + 1;
      if (memberCallNumber > group.maxRounds) throw Error('A2A_GROUP_CALL_LIMIT');
    }
    const now = new Date().toISOString();
    const link: A2ATaskLink = { ...input, ...(parent ? { parentRunId: parent.id, memberCallNumber } : {}), id, state: 'submitted', createdAt: now, updatedAt: now };
    store.a2aTaskLinks.push(link);
    return { created: true, link };
  });
}
export function updateA2ATaskLink(id: string, update: Partial<Pick<A2ATaskLink, 'remoteTaskId' | 'remoteState' | 'task' | 'state' | 'lookupState' | 'checkedAt' | 'diskResult' | 'cancelState' | 'cancelAttempts' | 'cancelCheckedAt'>>) {
  return mutateStoreCollections(['a2aTaskLinks'], store => {
    const row = store.a2aTaskLinks.find(row => row.id === id) as A2ATaskLink;
    if (!row) throw Error('A2A_LINK_MISSING');
    if (row.state === 'finished' && update.state && update.state !== 'finished') return row;
    if (row.state === 'finished' && update.task && row.remoteState && update.task.status?.state !== row.remoteState) return row;
    if (update.remoteTaskId && row.remoteTaskId && row.remoteTaskId !== update.remoteTaskId) throw Error('A2A_REMOTE_ID_CONFLICT');
    Object.assign(row, update, { updatedAt: new Date().toISOString() });
    return row;
  });
}

export function selectA2ATaskLinksForRefresh(options: {
  links: A2ATaskLink[];
  instanceId: string;
  trustedPeerIds: Set<string>;
  visibleTasks: Set<string>;
  refreshBefore: number;
  limit?: number;
}) {
  return options.links.filter(row => row.instanceId === options.instanceId
    && Boolean(row.remoteTaskId)
    && row.state !== 'finished'
    && options.trustedPeerIds.has(row.peerId)
    && options.visibleTasks.has(`${row.peerId}\n${row.callerTaskId}\n${row.contextId}`)
    && (!row.checkedAt || new Date(row.checkedAt).getTime() < options.refreshBefore))
    .slice(0, Math.min(10, Math.max(1, options.limit || 3)));
}
