import express from 'express';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getInstance: vi.fn(), send: vi.fn() }));
vi.mock('../db', () => ({ dbAdapter: { getInstanceById: state.getInstance } }));
vi.mock('../crypto', () => ({ decrypt: () => 'test-peer-secret' }));
vi.mock('../services/a2aTrackedTransport', () => ({ trackedA2ASend: state.send }));
import { a2aRelayToken } from '../services/a2aRelayConfig';
import { createA2ARelayRouter } from './a2aRelay';
beforeEach(() => {
  vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', 'caller');
  vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'true'); vi.stubEnv('MYBAY_INTERNAL_ROUTING_SECRET', 'isolated-test-secret');
  state.getInstance.mockImplementation(async id => ({ id, user_id: 'owner', config_json: JSON.stringify({ a2aEnabled: true, a2aPeerIds: ['peer'], a2aBearerToken: 'encrypted' }) }));
  state.send.mockResolvedValue({ jsonrpc: '2.0', id: 'task-one', result: { task: { id: 'remote-one' } } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function serve(test: (url: string) => Promise<void>) {
  const app=express(); app.use(express.json()); app.use('/internal/a2a', createA2ARelayRouter());
  const server=app.listen(0); await new Promise<void>(resolve=>server.once('listening',resolve));
  try { await test(`http://127.0.0.1:${(server.address() as any).port}/internal/a2a/caller/peer`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
}
const body = { jsonrpc: '2.0', id: 'task-one', method: 'SendMessage', params: { message: { contextId: 'ctx-one' } } };
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
