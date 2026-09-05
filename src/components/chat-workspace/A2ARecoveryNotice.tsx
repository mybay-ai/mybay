import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { readA2ARecoverySource, sameA2ARecoverySource, type resolveA2ARecoveryEvidence } from '../../../shared/a2aRecovery';

type RecoveryEvidence = ReturnType<typeof resolveA2ARecoveryEvidence>;
export function A2ATaskEvidence({ evidence }: { evidence: RecoveryEvidence }) {
  const { t } = useTranslation('dashboard');
  const status = (value: string) => { value = value === 'canceled' ? 'cancelled' : ['working', 'submitted'].includes(value) ? 'in_progress' : value; return t('a2a.activityStatuses.' + (['completed', 'in_progress', 'connection_failed', 'timed_out', 'agent_offline', 'auth_failed', 'cancelled', 'failed'].includes(value) ? value : 'unknown')); };
  return <div className="mt-2 border-t border-outline pt-2">
    <div className="font-semibold">{t('a2a.originalTaskRecord')}: {status(evidence.originalStatus)}</div>
    <div className="break-all font-mono">{evidence.source.taskId}</div>
    {evidence.remoteMapping && <div className="mt-2">
      <div className="font-semibold">{t(evidence.remoteMapping.lookupState ? 'a2a.lastRemoteTaskState' : 'a2a.mappedRemoteTask')}: {status(evidence.remoteMapping.remoteState.replace(/^TASK_STATE_/, '').toLowerCase().replaceAll('_', '-'))}</div>
      <div className="break-all font-mono">{evidence.remoteMapping.remoteTaskId}</div>
      {evidence.remoteMapping.lookupState && <p role="status">{t('a2a.remoteLookup.' + evidence.remoteMapping.lookupState)}</p>}
      {evidence.remoteMapping.diskResult && <div className="mt-2"><div className="font-semibold">{t('a2a.diskReplyLabel')}</div><pre className="whitespace-pre-wrap break-words font-sans">{evidence.remoteMapping.diskResult}</pre></div>}
      <p>{t(evidence.remoteMapping.recordState === 'finished' ? 'a2a.remoteMappingRecorded' : 'a2a.remoteMappingPending')}</p>
      {evidence.remoteMapping.result && <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{evidence.remoteMapping.result}</pre>}
    </div>}
    {!evidence.originalFound && <p>{t('a2a.originalTaskMissing')}</p>}
    <p className="mt-1">{t('a2a.taskAttributionHint')}</p>
    {evidence.otherTasks.length > 0 && <details className="mt-1">
      <summary className="cursor-pointer">{t('a2a.otherContextTasks')}</summary>
      {evidence.otherTasks.map((task, index) => <div key={`${task.taskId}-${index}`} className="mt-1 break-all"><span className="font-mono">{task.taskId}</span> · {status(task.status)}</div>)}
      {evidence.otherTasksTruncated && <p>{t('a2a.otherTasksTruncated')}</p>}
    </details>}
  </div>;
}

export function recoveryCheckStage(status: string): 'waiting' | 'running' | 'finished' | 'failed' | 'stopped' | 'unknown' {
  if (status === 'queued') return 'waiting';
  if (['pending', 'streaming', 'running', 'stopping'].includes(status)) return 'running';
  if (status === 'completed') return 'finished';
  if (['failed', 'expired'].includes(status)) return 'failed';
  if (['cancelled', 'stopped'].includes(status)) return 'stopped';
  return 'unknown';
}

export function A2ARecoveryNotice({ source, status, instanceId }: { source: unknown; status: string; instanceId?: string }) {
  const { t } = useTranslation('dashboard');
  const reference = readA2ARecoverySource(source);
  const [evidence, setEvidence] = useState<RecoveryEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const identity = JSON.stringify([instanceId, reference, status]);
  useEffect(() => {
    setEvidence(null); setError(false); setLoading(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [identity]);
  async function checkRecords() {
    if (!instanceId || !reference) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(false); setEvidence(null);
    try {
      const query = new URLSearchParams(reference).toString();
      const data = await api.get(`/api/instances/${encodeURIComponent(instanceId)}/a2a/activity?${query}&refreshRemote=1`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!data.recoveryEvidence || !sameA2ARecoverySource(data.recoveryEvidence.source, reference)) throw new Error('Evidence source mismatch');
      setEvidence(data.recoveryEvidence);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  if (!reference) return null;
  const stage = recoveryCheckStage(status);
  return <aside className="mb-3 rounded-lg border border-outline bg-surface-muted px-3 py-2.5 text-xs leading-5" aria-label={t('a2a.checkNoticeTitle')}>
    <div className="font-semibold text-content">{t('a2a.checkStages.' + stage)}</div>
    <p className="mt-1 text-content-secondary">{t(stage === 'finished' ? 'a2a.checkFinishedHint' : 'a2a.checkScopeHint')}</p>
    {instanceId && <button type="button" className="mt-1 text-content underline underline-offset-2 disabled:opacity-50" disabled={loading} onClick={checkRecords}>{t(loading ? 'a2a.checkingTaskRecords' : 'a2a.checkTaskRecords')}</button>}
    {error && <p role="alert">{t('a2a.taskRecordsUnavailable')}</p>}
    {evidence && <A2ATaskEvidence evidence={evidence} />}
    <details className="mt-1 text-content-muted"><summary className="cursor-pointer">{t('a2a.sourceDetails')}</summary><div className="mt-1 break-all font-mono">{reference.contextId}<br />{reference.taskId}<br />{reference.peerId}</div></details>
  </aside>;
}
