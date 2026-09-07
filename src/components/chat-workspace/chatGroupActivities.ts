export type ChatGroupActivity = {
  contextId: string;
  taskId: string;
  startedAt: string;
  peerId: string | null;
  peerName: string;
  status: string;
  result?: string | null;
  failureReason?: string | null;
  remoteMapping?: {
    remoteTaskId: string;
    remoteState: string;
    recordState: string;
    updatedAt: string;
    result?: string;
    lookupState?: 'not_found' | 'unavailable' | 'disk_reply';
    checkedAt?: string;
    diskResult?: string;
    cancelState?: 'pending' | 'confirmed' | 'unconfirmed';
    cancelCheckedAt?: string;
  } | null;
};

export function groupMemberCalls(activities: ChatGroupActivity[], contextId: string, peerId: string) {
  return activities.filter(activity => activity.contextId === contextId && activity.peerId === peerId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.taskId.localeCompare(b.taskId));
}
