import crypto from 'node:crypto';
import { beginA2ATaskLink, updateA2ATaskLink, type A2ATaskLink } from './a2aTaskLinks';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,160}$/.test(value);
const terminal = (state: string) => ['completed', 'failed', 'canceled', 'cancelled', 'rejected', 'input-required', 'auth-required'].includes(state.replace(/^TASK_STATE_/, '').toLowerCase().replaceAll('_', '-'));

export async function refreshMappedA2ATask(link: A2ATaskLink, read: (remoteId: string) => Promise<any>) {
  if (!link.remoteTaskId || link.state === 'finished') return link;
  const task = await read(link.remoteTaskId);
  if (task?.id !== link.remoteTaskId || task?.contextId !== link.contextId || typeof task?.status?.state !== 'string') throw Error('A2A_RESPONSE_MISMATCH');
  return updateA2ATaskLink(link.id, { remoteTaskId: task.id, remoteState: task.status.state, task, state: terminal(task.status.state) ? 'finished' : 'mapped', lookupState: undefined, diskResult: undefined, checkedAt: new Date().toISOString() });
}

// Convert the peer's streaming RPC to the existing Hermes unary result. Persist
// the first server-issued task ID before waiting for completion. Caller socket
// closure does not cancel remote work or discard late evidence.
export async function trackedA2ASend(options: {
  instanceId: string; peerId: string; body: any;
  send: (body: any) => Promise<Response>;
}) {
  const { body } = options;
  const contextId = body?.params?.message?.contextId;
  if (!validId(body?.id) || !validId(contextId) || !['SendMessage', 'message/send'].includes(body?.method)) throw Error('A2A_INVALID_REQUEST');
  const { created, link } = beginA2ATaskLink({ instanceId: options.instanceId, peerId: options.peerId, contextId,
    callerTaskId: body.id, fingerprint: crypto.createHash('sha256').update(JSON.stringify(body.params)).digest('hex') });
  if (!created) {
    if (link.state === 'finished' && link.task) return { jsonrpc: '2.0', id: body.id, result: body.method === 'SendMessage' ? { task: link.task } : link.task };
    // A crash between dispatch and acknowledgement is uncertain; never resend.
    throw Error('A2A_ALREADY_SUBMITTED_CHECK_RECORD');
  }
  let task: any;
  try {
    const response = await options.send({ ...body, method: 'message/stream' });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('A2A_STREAM_UNAVAILABLE');
    let pending = ''; let bytes = 0;
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 2 * 1024 * 1024) throw Error('A2A_RESPONSE_LIMIT');
        pending = (pending + decoder.decode(next.value, { stream: true })).replaceAll('\r\n', '\n');
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') continue;
          const envelope = JSON.parse(data);
          if (envelope.id !== body.id || envelope.error) throw Error('A2A_RESPONSE_MISMATCH');
          const result = envelope.result;
          const row = result?.task || result?.statusUpdate || result?.artifactUpdate;
          if (!row) continue;
          const remoteId = result.task ? row.id : row.taskId;
          if (!validId(remoteId) || row.contextId !== contextId) throw Error('A2A_RESPONSE_MISMATCH');
          if (task && task.id !== remoteId) throw Error('A2A_REMOTE_ID_CONFLICT');
          task ||= { id: remoteId, contextId, status: { state: 'unknown' } };
          if (result.task) task = row;
          if (result.statusUpdate) task.status = row.status;
          if (result.artifactUpdate) task.artifacts = [...(task.artifacts || []).filter((a: any) => a.artifactId !== row.artifact.artifactId), row.artifact];
          updateA2ATaskLink(link.id, { remoteTaskId: remoteId, remoteState: task.status?.state || 'unknown', task, state: 'mapped' });
        }
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!task || !terminal(task.status?.state || '')) throw Error('A2A_STREAM_INCOMPLETE');
    updateA2ATaskLink(link.id, { state: 'finished', task });
    return { jsonrpc: '2.0', id: body.id, result: body.method === 'SendMessage' ? { task } : task };
  } catch (error) {
    updateA2ATaskLink(link.id, { state: 'uncertain' });
    throw error;
  }
}
