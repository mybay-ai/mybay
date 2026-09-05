import { beforeEach, expect, it, vi } from 'vitest';
import { mutateStoreCollections, closeLocalDatabase } from '../localStore';
import { getA2ATaskLink } from './a2aTaskLinks';
import { trackedA2ASend, refreshMappedA2ATask } from './a2aTrackedTransport';

beforeEach(() => { mutateStoreCollections(['a2aTaskLinks'], store => { store.a2aTaskLinks = []; }); });
const body = { jsonrpc: '2.0', id: 'task-caller', method: 'SendMessage', params: { message: { contextId: 'ctx-one', role: 'user', parts: [{ text: 'hello' }] } } };
const opts = { instanceId: 'caller', peerId: 'peer', body };
const frame = (result: any, id = body.id) => `data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`;
const task = { id: 'task-remote', contextId: 'ctx-one', status: { state: 'TASK_STATE_SUBMITTED' } };
const done = { statusUpdate: { taskId: task.id, contextId: task.contextId, status: { state: 'TASK_STATE_COMPLETED' } } };
function stream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }), { headers: { 'content-type': 'text/event-stream' } });
  return { response, emit(text: string) { controller.enqueue(new TextEncoder().encode(text)); }, end() { controller.close(); } };
}
it('persists mapping before completion and retains late results without a second dispatch', async () => {
  const s = stream(); const send = vi.fn(async () => s.response);
  const pending = trackedA2ASend({ ...opts, send });
  s.emit(frame({ task }));
  await vi.waitFor(() => expect(getA2ATaskLink('caller', 'peer', body.id)?.remoteTaskId).toBe(task.id));
  closeLocalDatabase();
  expect(getA2ATaskLink('caller', 'peer', body.id)?.state).toBe('mapped');
  await expect(trackedA2ASend({ ...opts, send })).rejects.toThrow('A2A_ALREADY_SUBMITTED_CHECK_RECORD');
  s.emit(frame({ artifactUpdate: { taskId: task.id, contextId: task.contextId, artifact: { artifactId: 'reply', parts: [{ text: 'late result' }] } } }));
  s.emit(frame(done)); s.end();
  const result = await pending;
  expect(result.result.task.artifacts[0].parts[0].text).toBe('late result');
  closeLocalDatabase();
  expect(await trackedA2ASend({ ...opts, send })).toEqual(result);
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not silently resend an interrupted dispatch after reopen', async () => {
  const send = vi.fn(async () => { throw Error('network interrupted'); });
  await expect(trackedA2ASend({ ...opts, send })).rejects.toThrow('network interrupted');
  closeLocalDatabase();
  await expect(trackedA2ASend({ ...opts, send })).rejects.toThrow('A2A_ALREADY_SUBMITTED_CHECK_RECORD');
  expect(send).toHaveBeenCalledTimes(1);
  expect(getA2ATaskLink('caller', 'peer', body.id)?.state).toBe('uncertain');
});
it.each(['context', 'task', 'rpc'])('rejects mismatched %s evidence without recording success', async kind => {
  const s = stream(); const pending = trackedA2ASend({ ...opts, send: async () => s.response });
  const failure = expect(pending).rejects.toThrow(/A2A_(RESPONSE_MISMATCH|REMOTE_ID_CONFLICT)/);
  s.emit(frame({ task }));
  s.emit(frame({ statusUpdate: { ...done.statusUpdate, ...(kind === 'context' ? { contextId: 'ctx-other' } : kind === 'task' ? { taskId: 'task-other' } : {}) } }, kind === 'rpc' ? 'request-other' : body.id)); s.end();
  await failure;
  expect(getA2ATaskLink('caller', 'peer', body.id)).toMatchObject({ state: 'uncertain', remoteTaskId: task.id });
});
it('rejects reuse of a caller ID with changed input', async () => {
  await expect(trackedA2ASend({ ...opts, send: async () => { throw Error('offline'); } })).rejects.toThrow();
  await expect(trackedA2ASend({ ...opts, body: { ...body, params: { message: { ...body.params.message, parts: [{ text: 'different' }] } } }, send: vi.fn() })).rejects.toThrow('A2A_REQUEST_CONFLICT');
});

it('recovers by the saved remote ID after an interrupted stream and rejects another task result', async () => {
  const s = stream(); const pending = trackedA2ASend({ ...opts, send: async () => s.response });
  const failure = expect(pending).rejects.toThrow('A2A_STREAM_INCOMPLETE');
  s.emit(frame({ task })); s.end(); await failure;
  closeLocalDatabase();
  const link = getA2ATaskLink('caller', 'peer', body.id)!;
  await expect(refreshMappedA2ATask(link, async () => ({ ...task, id: 'task-unrelated', status: { state: 'TASK_STATE_COMPLETED' } }))).rejects.toThrow('A2A_RESPONSE_MISMATCH');
  expect(getA2ATaskLink('caller', 'peer', body.id)?.state).toBe('uncertain');
  const read = vi.fn(async () => ({ ...task, status: { state: 'TASK_STATE_COMPLETED' } }));
  const recovered = await refreshMappedA2ATask(link, read);
  expect(read).toHaveBeenCalledWith('task-remote');
  expect(recovered).toMatchObject({ state: 'finished', remoteTaskId: task.id, remoteState: 'TASK_STATE_COMPLETED' });
});
