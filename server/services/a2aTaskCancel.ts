import { updateA2ATaskLink, type A2ATaskLink } from './a2aTaskLinks';
export async function cancelA2ATask(link: A2ATaskLink, send: (taskId: string) => Promise<any>) {
  if (!link.remoteTaskId) throw Error('A2A_REMOTE_ID_REQUIRED');
  if (link.state === 'finished' || link.diskResult) throw Error('A2A_TASK_ALREADY_RESOLVED');
  const task = await send(link.remoteTaskId);
  if (task?.id !== link.remoteTaskId || task?.contextId !== link.contextId || !['TASK_STATE_CANCELED','canceled','cancelled'].includes(task?.status?.state)) throw Error('A2A_CANCEL_UNCONFIRMED');
  return updateA2ATaskLink(link.id, { task, remoteState: task.status.state, state: 'finished', lookupState: undefined, checkedAt: new Date().toISOString() });
}
