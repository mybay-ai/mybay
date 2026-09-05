import crypto from 'node:crypto';
export function a2aTrackingEnabled(instanceId?: string) {
  if (process.env.MYBAY_A2A_TASK_TRACKING !== 'true') return false;
  const instances = (process.env.MYBAY_A2A_TRACKED_INSTANCES || '').split(',').map(id => id.trim()).filter(Boolean);
  // An empty scope never enables all instances implicitly.
  return instanceId ? instances.includes(instanceId) : instances.length > 0;
}
export function a2aRelayToken(instanceId: string) {
  const secret = process.env.MYBAY_INTERNAL_ROUTING_SECRET;
  if (!secret) throw Error('A2A_RELAY_SECRET_REQUIRED');
  return crypto.createHmac('sha256', secret).update(`mybay:a2a-relay:v1:${instanceId}`).digest('hex');
}
export function a2aRelayUrl(instanceId: string, peerId: string) {
  const host = process.env.MYBAY_CONTROL_PANEL_CONTAINER || 'mybay-local-control-panel';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host)) throw Error('A2A_RELAY_HOST_INVALID');
  return `http://${host}:3000/internal/a2a/${encodeURIComponent(instanceId)}/${encodeURIComponent(peerId)}`;
}
