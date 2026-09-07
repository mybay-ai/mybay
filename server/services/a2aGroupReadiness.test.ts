import { afterEach, expect, it, vi } from 'vitest';
const inspect = vi.hoisted(() => vi.fn());
vi.mock('../lib/docker', () => ({ docker: { getContainer: () => ({ inspect }) } }));
import { isA2AGroupTransportApplied } from './a2aGroupReadiness';
import { a2aRelayRevision, a2aRelayToken, a2aRelayUrl } from './a2aRelayConfig';
afterEach(() => vi.unstubAllEnvs());
it('requires explicit tracking and the applied revision of actual relay URLs and credentials', async () => {
  vi.stubEnv('MYBAY_A2A_TASK_TRACKING', 'true'); vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', 'host'); vi.stubEnv('MYBAY_INTERNAL_ROUTING_SECRET', 'test');
  const instance = { id: 'host', status: 'running', config_json: { a2aEnabled: true, a2aRevision: 'current', a2aPeerIds: ['peer'] } };
  const revision = a2aRelayRevision([{ id: 'peer', url: a2aRelayUrl('host', 'peer'), token: a2aRelayToken('host') }]);
  inspect.mockResolvedValue({ State: { Running: true }, Config: { Env: ['MYBAY_A2A_REVISION=current'] } });
  expect(await isA2AGroupTransportApplied(instance)).toBe(false);
  inspect.mockResolvedValue({ State: { Running: true }, Config: { Env: ['MYBAY_A2A_REVISION=current', `MYBAY_A2A_RELAY_REVISION=${revision}`] } });
  expect(await isA2AGroupTransportApplied(instance)).toBe(true);
  vi.stubEnv('MYBAY_INTERNAL_ROUTING_SECRET', 'rotated');
  expect(await isA2AGroupTransportApplied(instance)).toBe(false);
  vi.stubEnv('MYBAY_A2A_TRACKED_INSTANCES', '');
  expect(await isA2AGroupTransportApplied(instance)).toBe(false);
});
