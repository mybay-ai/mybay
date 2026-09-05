import { expect, it } from "vitest";
import { readA2ARecoverySource, sameA2ARecoverySource, resolveA2ARecoveryEvidence, a2aRecoveryTaskPolicy } from "./a2aRecovery";
it("accepts bounded references and rejects malformed identities", () => {
  const source = { contextId: "ctx-one", taskId: "task-two", peerId: "peer-three" };
  expect(readA2ARecoverySource(source)).toEqual(source);
  for (const value of [null, {}, { ...source, peerId: "../foreign" }, { ...source, taskId: "x".repeat(161) }]) expect(readA2ARecoverySource(value)).toBeNull();
  expect(sameA2ARecoverySource(source, { ...source })).toBe(true);
  expect(sameA2ARecoverySource(source, { ...source, taskId: "other" })).toBe(false);
  expect(sameA2ARecoverySource(source, null)).toBe(false);
});

it('does not transfer success between tasks, peers or directions in the same context', () => {
  const source = { contextId: 'ctx-one', taskId: 'task-original', peerId: 'peer-one' };
  const original = { ...source, direction: 'outbound', status: 'agent_offline' };
  const evidence = resolveA2ARecoveryEvidence(source, [original,
    { ...original, taskId: 'task-later', status: 'completed' },
    { ...original, peerId: 'peer-other', status: 'completed' },
    { ...original, direction: 'inbound', status: 'completed' },
    { ...original, contextId: 'ctx-other', status: 'completed' },
  ]);
  expect(evidence.originalStatus).toBe('agent_offline');
  expect(evidence.otherTasks).toEqual([{ taskId: 'task-later', status: 'completed' }]);
  expect(resolveA2ARecoveryEvidence(source, [{ ...original, taskId: 'task-later', status: 'completed' }])).toMatchObject({ originalFound: false, originalStatus: 'unknown' });
  expect(resolveA2ARecoveryEvidence(source, [{ ...original, status: 'completed', evidenceIncomplete: true }]).originalStatus).toBe('unknown');
  expect(resolveA2ARecoveryEvidence(source, [original, { ...original, status: 'completed' }]).originalStatus).toBe('unknown');
});

it('applies exact-task attribution guidance only to valid recovery sources', () => {
  expect(a2aRecoveryTaskPolicy(undefined)).toBe('');
  expect(a2aRecoveryTaskPolicy({ contextId: 'ctx', taskId: 'task', peerId: 'peer' })).toContain('original task_id=task');
  expect(a2aRecoveryTaskPolicy({ contextId: 'ctx', taskId: 'task', peerId: 'peer' })).toContain('does NOT prove the original task completed');
});
