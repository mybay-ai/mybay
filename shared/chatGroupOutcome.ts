import { readChatGroupRun } from './chatCollaboration';

type Link = { parentRunId?: string; peerId: string; state: string; remoteState?: string; lookupState?: string };
export function resolveChatGroupOutcome(run: { id: string; status: string; group_collaboration?: unknown } | undefined, links: Link[]) {
  const group = readChatGroupRun(run?.group_collaboration);
  if (!run || !group) return 'unknown';
  const calls = links.filter(link => link.parentRunId === run.id && group.selectedPeerIds?.includes(link.peerId));
  const missing = group.selectedPeerIds?.some(id => !calls.some(call => call.peerId === id));
  const state = (link: Link) => String(link.remoteState || '').replace(/^TASK_STATE_/, '').toLowerCase().replaceAll('_', '-');
  const completed = calls.filter(link => link.state === 'finished' && state(link) === 'completed' && !link.lookupState).length;
  const failed = calls.filter(link => link.state === 'finished' && ['failed', 'canceled', 'cancelled', 'rejected', 'auth-required', 'input-required'].includes(state(link))).length;
  const unresolved = calls.length - completed - failed;
  if (missing || unresolved) return ['queued', 'running'].includes(run.status) ? 'in_progress' : 'unknown';
  if (!calls.length) return 'unknown';
  if (calls.every(link => link.state === 'finished' && ['canceled', 'cancelled'].includes(state(link)))) return 'cancelled';
  return completed === calls.length ? 'completed' : completed > 0 ? 'partial' : 'failed';
}
