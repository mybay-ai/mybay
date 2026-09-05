import crypto from 'node:crypto';
import { beginA2ATaskLink, updateA2ATaskLink, type A2ATaskLink } from './a2aTaskLinks';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,160}$/.test(value);
const normalizedState = (state: string) => state.replace(/^TASK_STATE_/, '').toLowerCase().replaceAll('_', '-');
const terminal = (state: string) => ['completed', 'failed', 'canceled', 'cancelled', 'rejected'].includes(normalizedState(state));
const actionRequired = (state: string) => ['input-required', 'auth-required'].includes(normalizedState(state));
const streamSettled = (state: string) => terminal(state) || actionRequired(state);

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
  read?: (remoteId: string) => Promise<any>;
  resumeLink?: A2ATaskLink;
}) {
  const { body } = options;
  const contextId = body?.params?.message?.contextId;
  if (!validId(body?.id) || !validId(contextId) || !['SendMessage', 'message/send'].includes(body?.method)) throw Error('A2A_INVALID_REQUEST');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body.params)).digest('hex');
  const started = options.resumeLink
    ? { created: false, link: options.resumeLink }
    : beginA2ATaskLink({ instanceId: options.instanceId, peerId: options.peerId, contextId,
      callerTaskId: body.id, fingerprint });
  const { created, link } = started;
  if (!created) {
    if (link.state === 'finished' && link.task) return { jsonrpc: '2.0', id: body.id, result: body.method === 'SendMessage' ? { task: link.task } : link.task };
    if (!link.remoteTaskId || !options.read) throw Error('A2A_ALREADY_SUBMITTED_CHECK_RECORD');
    const deadline = Date.now() + 180_000;
    let recovered = link;
    while (Date.now() < deadline) {
      recovered = await refreshMappedA2ATask(recovered, options.read);
      if (recovered.task && streamSettled(recovered.task.status?.state || '')) {
        return { jsonrpc: '2.0', id: body.id, result: body.method === 'SendMessage' ? { task: recovered.task } : recovered.task };
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw Error('A2A_RECOVERY_TIMEOUT');
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
          consumeFrame(frame);
        }
      }
      pending = (pending + decoder.decode()).replaceAll('\r\n', '\n');
      // Some compliant peers close immediately after the final SSE data line
      // without an extra blank separator. The EOF boundary still completes it.
      if (pending.trim()) consumeFrame(pending);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!task || !streamSettled(task.status?.state || '')) throw Error('A2A_STREAM_INCOMPLETE');
    updateA2ATaskLink(link.id, { state: terminal(task.status?.state || '') ? 'finished' : 'mapped', task });
    return { jsonrpc: '2.0', id: body.id, result: body.method === 'SendMessage' ? { task } : task };
  } catch (error) {
    updateA2ATaskLink(link.id, { state: 'uncertain' });
    throw error;
  }

  function consumeFrame(frame: string) {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const envelope = JSON.parse(data);
    if (envelope.id !== body.id || envelope.error) throw Error('A2A_RESPONSE_MISMATCH');
    const result = envelope.result;
    const row = result?.task || result?.statusUpdate || result?.artifactUpdate;
    if (!row) return;
    const remoteId = result.task ? row.id : row.taskId;
    if (!validId(remoteId) || row.contextId !== contextId) throw Error('A2A_RESPONSE_MISMATCH');
    if (task && task.id !== remoteId) throw Error('A2A_REMOTE_ID_CONFLICT');
    task ||= { id: remoteId, contextId, status: { state: 'unknown' } };
    if (result.task) task = row;
    if (result.statusUpdate) task.status = row.status;
    if (result.artifactUpdate) task.artifacts = [...(task.artifacts || []).filter((a: any) => a.artifactId !== row.artifact.artifactId), row.artifact];
    const state = terminal(task.status?.state || '') ? 'finished' : 'mapped';
    updateA2ATaskLink(link.id, { remoteTaskId: remoteId, remoteState: task.status?.state || 'unknown', task, state });
  }
}
