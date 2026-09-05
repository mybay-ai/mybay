import { Router } from 'express';
import crypto from 'node:crypto';
import { dbAdapter } from '../db';
import { decrypt } from '../crypto';
import { getA2AInternalUrl } from '../../shared/a2aConfig';
import { a2aRelayToken, a2aRelayUrl, a2aTrackingEnabled } from '../services/a2aRelayConfig';
import { trackedA2ASend } from '../services/a2aTrackedTransport';

const parseConfig = (row: any) => typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json || {};
export function createA2ARelayRouter() {
  const router = Router();
  const active = new Set<string>();
  router.use(async (req, res, next) => {
    if (!a2aTrackingEnabled()) return res.sendStatus(404);
    next();
  });
  router.use('/:instanceId/:peerId', async (req, res) => {
    try {
      const { instanceId, peerId } = req.params;
      if (!a2aTrackingEnabled(instanceId)) return res.sendStatus(404);
      if (![instanceId, peerId].every(value => /^[a-zA-Z0-9-]{1,160}$/.test(value))) return res.sendStatus(400);
      const expected = Buffer.from(a2aRelayToken(instanceId));
      const supplied = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, ''));
      if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return res.sendStatus(401);
      const caller = await dbAdapter.getInstanceById(instanceId);
      const peer = await dbAdapter.getInstanceById(peerId);
      if (!caller || !peer || !(caller.user_id || caller.owner_id) || (caller.user_id || caller.owner_id) !== (peer.user_id || peer.owner_id)) return res.sendStatus(403);
      const config = parseConfig(caller); const peerConfig = parseConfig(peer);
      if (!config.a2aEnabled || !peerConfig.a2aEnabled || !config.a2aPeerIds?.includes(peerId) || !peerConfig.a2aBearerToken) return res.sendStatus(403);
      if (req.method === 'GET' && ['/.well-known/agent-card.json', '/.well-known/agent.json'].includes(req.path)) {
        return res.json({ name: 'MyBay tracked A2A peer', description: 'Tracked internal collaboration', capabilities: { streaming: false }, supportedInterfaces: [{ protocolBinding: 'JSONRPC', protocolVersion: '1.0', url: a2aRelayUrl(instanceId, peerId) }], skills: [] });
      }
      if (req.method !== 'POST' || !['/', ''].includes(req.path)) return res.sendStatus(404);
      const body = req.body;
      if (!body?.params?.message || Object.keys(body.params).some(key => key !== 'message')) return res.sendStatus(400);
      // Bound sockets and model dispatches; no automatic retries on uncertainty.
      const activeKey = JSON.stringify([instanceId, peerId, body.id]);
      if (active.size >= 16 || active.has(activeKey)) return res.sendStatus(429);
      active.add(activeKey);
      try {
        const result = await trackedA2ASend({ instanceId, peerId, body, send: request => fetch(getA2AInternalUrl(peerId), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decrypt(peerConfig.a2aBearerToken)}` },
          body: JSON.stringify(request), redirect: 'error', signal: AbortSignal.timeout(180_000),
        }) });
        if (!res.destroyed) res.json(result);
      } finally { active.delete(activeKey); }
    } catch (error: any) {
      if (!res.destroyed) res.status(502).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message: /^A2A_[A-Z_]+$/.test(error.message) ? error.message : 'A2A_RELAY_UNAVAILABLE' } });
    }
  });
  return router;
}
