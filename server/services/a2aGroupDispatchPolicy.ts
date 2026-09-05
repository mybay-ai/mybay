import { readChatGroupRun } from '../../shared/chatCollaboration';
import type { A2ATaskLink } from './a2aTaskLinks';

export function evaluateA2AGroupDispatch(options: {
  runs: any[];
  links: A2ATaskLink[];
  instanceId: string;
  peerId: string;
  contextId: string;
  callerTaskId: string;
}) {
  const room = options.runs
    .filter(run => String(run.instance_id) === options.instanceId)
    .map(run => readChatGroupRun(run.group_collaboration))
    .find(group => group?.contextId === options.contextId);
  if (!room) return { allowed: true, room: false } as const;
  if (!room.peers.some(peer => peer.id === options.peerId)) {
    return { allowed: false, room: true, error: 'A2A_GROUP_MEMBER_NOT_ALLOWED' } as const;
  }
  const existing = options.links.filter(link => link.instanceId === options.instanceId
    && link.contextId === options.contextId
    && link.peerId === options.peerId);
  if (existing.some(link => link.callerTaskId === options.callerTaskId)) return { allowed: true, room: true } as const;
  if (existing.length >= room.maxRounds) return { allowed: false, room: true, error: 'A2A_GROUP_ROUND_LIMIT' } as const;
  return { allowed: true, room: true } as const;
}
