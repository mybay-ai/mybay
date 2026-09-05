// Summarize only observed outbound calls to this exact peer. A newer failure or
// pending call must never be hidden by an older success or another peer's result.
export function latestOutboundActivity<T extends { peerId: string | null; direction: string; startedAt: string }>(activities: T[], peerId: string): T | undefined {
  return activities.filter(item => item.peerId === peerId && item.direction === 'outbound' && Number.isFinite(Date.parse(item.startedAt)))
    .reduce<T | undefined>((latest, item) => !latest || Date.parse(item.startedAt) > Date.parse(latest.startedAt) ? item : latest, undefined);
}
