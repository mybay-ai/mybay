import { beforeEach, expect, it, vi } from 'vitest';
import { mutateStoreCollections } from '../localStore';
import { beginA2ATaskLink, getA2ATaskLink, updateA2ATaskLink } from './a2aTaskLinks';
import { cancelA2ATask } from './a2aTaskCancel';
beforeEach(()=>mutateStoreCollections(['a2aTaskLinks'],s=>{s.a2aTaskLinks=[];}));
const create=()=>beginA2ATaskLink({instanceId:'caller',peerId:'peer',contextId:'ctx-one',callerTaskId:'task-caller',fingerprint:'hash'}).link;
it('cancels only the exact mapped remote ID and persists the peer-confirmed terminal state',async()=>{
  const link=updateA2ATaskLink(create().id,{remoteTaskId:'task-remote',remoteState:'TASK_STATE_WORKING',state:'mapped'});
  const send=vi.fn(async()=>({id:'task-remote',contextId:'ctx-one',status:{state:'TASK_STATE_CANCELED'}}));
  await cancelA2ATask(link,send);
  expect(send).toHaveBeenCalledWith('task-remote');
  expect(getA2ATaskLink('caller','peer','task-caller')).toMatchObject({state:'finished',remoteState:'TASK_STATE_CANCELED'});
});
it('does not claim cancellation for mismatched or already resolved tasks',async()=>{
  let link=updateA2ATaskLink(create().id,{remoteTaskId:'task-remote',state:'mapped'});
  await expect(cancelA2ATask(link,async()=>({id:'other',contextId:'ctx-one',status:{state:'TASK_STATE_CANCELED'}}))).rejects.toThrow('A2A_CANCEL_UNCONFIRMED');
  link=updateA2ATaskLink(link.id,{state:'finished'});
  await expect(cancelA2ATask(link,vi.fn())).rejects.toThrow('A2A_TASK_ALREADY_RESOLVED');
});
it('does not let late stream state downgrade a finished cancellation',()=>{
  const link=updateA2ATaskLink(create().id,{state:'finished',remoteState:'TASK_STATE_CANCELED'});
  updateA2ATaskLink(link.id,{state:'mapped',remoteState:'TASK_STATE_WORKING'});
  expect(getA2ATaskLink('caller','peer','task-caller')).toMatchObject({state:'finished',remoteState:'TASK_STATE_CANCELED'});
});
