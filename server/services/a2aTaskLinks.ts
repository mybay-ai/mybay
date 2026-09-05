import crypto from 'node:crypto';
import { mutateStoreCollections, readStoreCollections } from '../localStore';

export type A2ATaskLink = {
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
  return mutateStoreCollections(['a2aTaskLinks'], store => {
    const id = linkKey(input.instanceId, input.peerId, input.callerTaskId);
    const found = store.a2aTaskLinks.find(row => row.id === id) as A2ATaskLink | undefined;
    if (found) {
      if (found.fingerprint !== input.fingerprint || found.contextId !== input.contextId) throw Error('A2A_REQUEST_CONFLICT');
      return { created: false, link: found };
    }
    const now = new Date().toISOString();
    const link: A2ATaskLink = { ...input, id, state: 'submitted', createdAt: now, updatedAt: now };
    store.a2aTaskLinks.push(link);
    return { created: true, link };
  });
}
export function updateA2ATaskLink(id: string, update: Partial<Pick<A2ATaskLink, 'remoteTaskId' | 'remoteState' | 'task' | 'state' | 'lookupState' | 'checkedAt' | 'diskResult'>>) {
  return mutateStoreCollections(['a2aTaskLinks'], store => {
    const row = store.a2aTaskLinks.find(row => row.id === id) as A2ATaskLink;
    if (!row) throw Error('A2A_LINK_MISSING');
    if (row.state === 'finished' && update.state && update.state !== 'finished') return row;
    if (update.remoteTaskId && row.remoteTaskId && row.remoteTaskId !== update.remoteTaskId) throw Error('A2A_REMOTE_ID_CONFLICT');
    Object.assign(row, update, { updatedAt: new Date().toISOString() });
    return row;
  });
}
