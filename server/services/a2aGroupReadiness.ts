import { docker } from '../lib/docker';
import { normalizeA2APeerIds } from '../../shared/a2aConfig';
import { a2aRelayRevision, a2aRelayToken, a2aRelayUrl, a2aTrackingEnabled } from './a2aRelayConfig';

export async function isA2AGroupTransportApplied(instance: any): Promise<boolean> {
  if (!a2aTrackingEnabled(String(instance.id)) || instance.status !== 'running') return false;
  try {
    const config = typeof instance.config_json === 'string' ? JSON.parse(instance.config_json) : instance.config_json || {};
    if (!config.a2aEnabled || !config.a2aRevision) return false;
    const revision = a2aRelayRevision(normalizeA2APeerIds(config.a2aPeerIds, instance.id).map(id => ({ id, url: a2aRelayUrl(instance.id, id), token: a2aRelayToken(instance.id) })));
    const details = await docker.getContainer(instance.container_id || `mybay-agent-${instance.id}`).inspect();
    const env = details.Config?.Env || [];
    return details.State?.Running === true && env.includes(`MYBAY_A2A_REVISION=${config.a2aRevision}`) && env.includes(`MYBAY_A2A_RELAY_REVISION=${revision}`);
  } catch { return false; }
}
