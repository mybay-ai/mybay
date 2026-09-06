import express from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getInstance: vi.fn(), send: vi.fn(), managedSend: vi.fn(), managed: false, store: { chatRuns: [] as any[], a2aTaskLinks: [] as any[] } }));
vi.mock('../db', () => ({ dbAdapter: { getInstanceById: state.getInstance } }));
vi.mock('../crypto', () => ({ decrypt: () => 'test-peer-secret' }));
vi.mock('../services/a2aTrackedTransport', () => ({ trackedA2ASend: state.send }));
vi.mock('../services/managedRuntimeA2A', () => ({
  isManagedRuntimeA2APeer: () => state.managed,
  isNativeA2APeer: (_peer: any, config: any) => config?.a2aEnabled === true,
  sendManagedRuntimeA2A: state.managedSend,
}));
vi.mock('../localStore', () => ({ readStoreCollections: () => state.store }));
import { a2aRelayToken } from '../services/a2aRelayConfig';
import { bindActiveGroupContext, createA2ARelayRouter } from './a2aRelay';
beforeEach(() => {
  vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', 'caller');
  vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'true'); vi.stubEnv('MYBAY_INTERNAL_ROUTING_SECRET', 'isolated-test-secret');
  state.getInstance.mockImplementation(async id => ({ id, user_id: 'owner', config_json: JSON.stringify({ a2aEnabled: true, a2aPeerIds: ['peer'], a2aBearerToken: 'encrypted' }) }));
  state.send.mockResolvedValue({ jsonrpc: '2.0', id: 'task-one', result: { task: { id: 'remote-one' } } });
  state.store.chatRuns = [];
  state.store.a2aTaskLinks = [];
  state.managed = false;
  state.managedSend.mockResolvedValue(new Response());
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function serve(test: (url: string) => Promise<void>) {
  const app=express(); app.use(express.json()); app.use('/internal/a2a', createA2ARelayRouter());
  const server=app.listen(0); await new Promise<void>(resolve=>server.once('listening',resolve));
  try { await test(`http://127.0.0.1:${(server.address() as any).port}/internal/a2a/caller/peer`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
}
const body = { jsonrpc: '2.0', id: 'task-one', method: 'SendMessage', params: { message: { contextId: 'ctx-one' } } };

it('binds relay calls to the single active collaboration-room context', () => {
  const group = { version: 1, mode: 'group', contextId: 'ctx-mybay-room-active', leader: { id: 'caller', name: 'Caller' }, peers: [{ id: 'peer', name: 'Peer' }], maxRounds: 1 };
  expect(bindActiveGroupContext(body, [{ instance_id: 'caller', status: 'running', group_collaboration: group }], 'caller').params.message.contextId)
    .toBe(group.contextId);
  expect(bindActiveGroupContext(body, [{ instance_id: 'caller', status: 'completed', group_collaboration: group }], 'caller'))
    .toBe(body);
});
const headers = () => ({ Authorization: `Bearer ${a2aRelayToken('caller')}`, 'Content-Type': 'application/json' });
it('rejects callers outside the explicit scope even with a valid relay credential', async () => {
  await serve(async url => {
    for (const scope of ['', 'another-caller']) {
      vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', scope);
      expect((await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: headers() })).status).toBe(404);
    }
    expect(state.getInstance).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });
});
it('is disabled by default and requires a caller-specific credential when enabled', async () => {
  await serve(async url => {
    expect((await fetch(url, {method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})).status).toBe(401);
    vi.stubEnv('MYBAY_A2A_TASK_TRACKING','false');
    expect((await fetch(url,{method:'POST',body:JSON.stringify(body),headers:headers()})).status).toBe(404);
    expect(state.send).not.toHaveBeenCalled();
  });
});
it('blocks cross-owner peers and arbitrary protocol configuration', async () => {
  await serve(async url => {
    state.getInstance.mockImplementation(async id => ({id,user_id:id,config_json:'{}'}));
    expect((await fetch(url,{method:'POST',body:JSON.stringify(body),headers:headers()})).status).toBe(403);
    expect(state.send).not.toHaveBeenCalled();
  });
});
it('accepts only the configured peer and returns no peer secret in discovery', async () => {
  await serve(async url => {
    const discovery=await (await fetch(url+'/.well-known/agent-card.json',{headers:headers()})).json();
    expect(JSON.stringify(discovery)).not.toContain('test-peer-secret');
    expect((await fetch(url,{method:'POST',headers:headers(),body:JSON.stringify({...body,params:{...body.params,pushNotification:{url:'http://untrusted'}}})})).status).toBe(400);
    expect((await fetch(url,{method:'POST',headers:headers(),body:JSON.stringify(body)})).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.send.mock.calls[0][0]).toMatchObject({instanceId:'caller',peerId:'peer',body});
  });
});
it('dispatches a configured Pi peer through the managed Runtime transport without its own A2A secret', async () => {
  state.managed = true;
  state.getInstance.mockImplementation(async id => id === 'caller'
    ? { id, user_id: 'owner', config_json: JSON.stringify({ a2aEnabled: true, a2aPeerIds: ['peer'], a2aBearerToken: 'encrypted' }) }
    : { id, user_id: 'owner', name: 'Pi reviewer', status: 'running', runtime_type: 'pi', config_json: '{}' });
  state.send.mockImplementation(async ({ send, body: requestBody }) => {
    await send(requestBody);
    return { jsonrpc: '2.0', id: requestBody.id, result: { task: { id: 'pi-run' } } };
  });
  await serve(async url => {
    const card = await (await fetch(url + '/.well-known/agent-card.json', { headers: headers() })).json();
    expect(card).toMatchObject({ name: 'Pi reviewer', description: 'MyBay managed Runtime collaboration peer' });
    expect((await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) })).status).toBe(200);
    expect(state.managedSend).toHaveBeenCalledWith(expect.objectContaining({ id: 'peer', runtime_type: 'pi' }), expect.objectContaining({ id: 'task-one' }));
  });
});
it('enforces the snapshotted collaboration-room member and round policy before dispatch', async () => {
  await serve(async url => {
    state.store.chatRuns = [{ instance_id: 'caller', group_collaboration: { version: 1, mode: 'group', contextId: 'ctx-mybay-room-policy', leader: { id: 'caller', name: 'Caller' }, peers: [{ id: 'peer', name: 'Peer' }], maxRounds: 1 } }];
    state.store.a2aTaskLinks = [{ id: 'saved', instanceId: 'caller', peerId: 'peer', contextId: 'ctx-mybay-room-policy', callerTaskId: 'task-old', fingerprint: 'fp', state: 'finished', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];
    const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify({ ...body, id: 'task-new', params: { message: { contextId: 'ctx-mybay-room-policy' } } }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: 'A2A_GROUP_ROUND_LIMIT' } });
    expect(state.send).not.toHaveBeenCalled();
  });
});
