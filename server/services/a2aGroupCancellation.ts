import crypto from 'node:crypto';
import { dbAdapter } from '../db';
import { decrypt } from '../crypto';
import { readStoreCollections } from '../localStore';
import { getA2AInternalUrl, normalizeA2APeerIds } from '../../shared/a2aConfig';
import { cancelA2ATask } from './a2aTaskCancel';
import { updateA2ATaskLink, type A2ATaskLink } from './a2aTaskLinks';

const configOf = (row: any) => typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json || {};
const ownerOf = (row: any) => row?.user_id || row?.owner_id;

export async function cancelManagedA2ATask(link: A2ATaskLink) {
  const [caller, peer] = await Promise.all([dbAdapter.getInstanceById(link.instanceId), dbAdapter.getInstanceById(link.peerId)]);
  if (!caller || !peer || !ownerOf(caller) || ownerOf(caller) !== ownerOf(peer)) throw Error('A2A_CANCEL_UNCONFIRMED');
  const config = configOf(caller); const peerConfig = configOf(peer);
  if (!config.a2aEnabled || !peerConfig.a2aEnabled || !peerConfig.a2aBearerToken || !normalizeA2APeerIds(config.a2aPeerIds, link.instanceId).includes(link.peerId)) throw Error('A2A_CANCEL_UNCONFIRMED');
  return cancelA2ATask(link, async remoteId => {
    const id = crypto.randomUUID();
    const response = await fetch(getA2AInternalUrl(link.peerId), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decrypt(peerConfig.a2aBearerToken)}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method: 'CancelTask', params: { id: remoteId } }) });
    if (!response.ok || !response.body) throw Error('A2A_CANCEL_UNCONFIRMED');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 256 * 1024) throw Error('A2A_CANCEL_UNCONFIRMED');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (rpc.id !== id || rpc.error) throw Error('A2A_CANCEL_UNCONFIRMED');
    return rpc.result?.task || rpc.result;
  });
}

let busy = false;
let timer: ReturnType<typeof setInterval> | undefined;
export async function reconcileA2AGroupCancellations(cancel = cancelManagedA2ATask) {
  if (busy) return;
  busy = true;
  try {
    const store = readStoreCollections(['chatRuns', 'a2aTaskLinks']);
    const stopped = new Set(store.chatRuns.filter(run => run.group_collaboration && run.stop_requested_at).map(run => run.id));
    const links = (store.a2aTaskLinks as A2ATaskLink[]).filter(link => link.parentRunId && stopped.has(link.parentRunId) && link.state !== 'finished' && !link.diskResult && (link.cancelAttempts || 0) < 3);
    for (const link of links.filter(link => !link.remoteTaskId)) {
      // Keep observing: the remote ID may arrive after the parent's stop.
      if (link.cancelState !== 'unconfirmed') updateA2ATaskLink(link.id, { cancelState: 'unconfirmed' });
    }
    await Promise.all(links.filter(link => link.remoteTaskId).slice(0, 16).map(async link => {
      updateA2ATaskLink(link.id, { cancelState: 'pending', cancelAttempts: (link.cancelAttempts || 0) + 1, cancelCheckedAt: new Date().toISOString() });
      try {
        await cancel(link);
        updateA2ATaskLink(link.id, { cancelState: 'confirmed', cancelCheckedAt: new Date().toISOString() });
      } catch {
        updateA2ATaskLink(link.id, { cancelState: 'unconfirmed', cancelCheckedAt: new Date().toISOString() });
      }
    }));
  } finally { busy = false; }
}
export function startA2AGroupCancellationWorker() {
  if (timer) return;
  const tick = () => { void reconcileA2AGroupCancellations().catch(() => console.error('[A2A] Group cancellation reconciliation failed')); };
  timer = setInterval(tick, 5000); timer.unref(); tick();
}
export function stopA2AGroupCancellationWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
