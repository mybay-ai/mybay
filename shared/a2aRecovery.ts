export type A2ARecoverySource = { contextId: string; taskId: string; peerId: string };
export function readA2ARecoverySource(value: unknown): A2ARecoverySource | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (![row.contextId, row.taskId, row.peerId].every(v => typeof v === "string" && /^[a-zA-Z0-9-]{1,160}$/.test(v))) return null;
  return { contextId: row.contextId as string, taskId: row.taskId as string, peerId: row.peerId as string };
}
export function sameA2ARecoverySource(a: A2ARecoverySource | null | undefined, b: A2ARecoverySource | null | undefined): boolean {
  return Boolean(a && b && a.contextId === b.contextId && a.taskId === b.taskId && a.peerId === b.peerId);
}

export type A2ATaskRecord = {
  contextId: string; taskId: string; peerId: string | null; direction: string;
  status: string; evidenceIncomplete?: boolean;
};
export function resolveA2ARecoveryEvidence(source: A2ARecoverySource, records: A2ATaskRecord[]) {
  const related = records.filter(row => row.direction === 'outbound' && row.contextId === source.contextId && row.peerId === source.peerId);
  const originals = related.filter(row => row.taskId === source.taskId);
  const originalStatus = originals.length === 1 && !originals[0].evidenceIncomplete ? originals[0].status : 'unknown';
  return {
    source, originalStatus,
    remoteMapping: null as null | { remoteTaskId: string; remoteState: string; recordState: string; updatedAt: string; result?: string; lookupState?: 'not_found' | 'unavailable' | 'disk_reply'; checkedAt?: string; diskResult?: string },
    originalFound: originals.length > 0,
    // Same context is observational grouping, never proof of retry lineage.
    otherTasks: related.filter(row => row.taskId !== source.taskId).slice(0, 20).map(row => ({
      taskId: row.taskId, status: row.evidenceIncomplete ? 'unknown' : row.status,
    })),
    otherTasksTruncated: related.filter(row => row.taskId !== source.taskId).length > 20,
  };
}

export function a2aRecoveryTaskPolicy(value: unknown): string {
  const source = readA2ARecoverySource(value);
  if (!source) return '';
  return `A2A recovery task attribution: original task_id=${source.taskId}, context_id=${source.contextId}, peer=${source.peerId}. Report the original task, this review, and any other call separately. A context groups multiple attempts: a successful reply in that context, identical message text, or a later successful call does NOT prove the original task completed. Only attribute a result to an exact task ID when tool evidence explicitly binds them. If evidence is context-only, report the observed reply and say original task outcome is unconfirmed; do not mark an offline/failed original successful. Distinguish caller task IDs from remote task IDs; never infer their mapping from context or timestamps. Agent Card discovery alone does not prove task-call authentication. Do not invent retry lineage or new IDs, and do not repeat a potentially side-effecting operation to resolve uncertainty.`;
}
