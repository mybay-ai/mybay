import { expect, it } from 'vitest';
import { latestOutboundActivity } from './a2aLatestActivity';
const row = (status: string, startedAt: string, peerId = 'peer', direction = 'outbound') => ({ status, startedAt, peerId, direction });
it('shows the newest call even when an older call succeeded and rows arrive out of order', () => {
  const failed = row('failed', '2026-09-05T03:00:00Z');
  expect(latestOutboundActivity([failed, row('completed', '2026-09-05T02:00:00Z')], 'peer')).toBe(failed);
});
it('does not use inbound activity, another peer, or invalid timestamps as verification', () => {
  expect(latestOutboundActivity([row('completed', '2026-09-05T03:00:00Z', 'other'), row('completed', '2026-09-05T04:00:00Z', 'peer', 'inbound'), row('completed', 'invalid')], 'peer')).toBeUndefined();
});
it('keeps a pending call as pending instead of falling back to earlier success', () => {
  expect(latestOutboundActivity([row('completed', '2026-09-05T02:00:00Z'), row('in_progress', '2026-09-05T03:00:00Z')], 'peer')?.status).toBe('in_progress');
});
