import { beforeEach, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
vi.mock("./runsReconciler", () => ({ requestRunsAPI: request }));

import {
  cancelManagedRuntimeA2ATask,
  isManagedRuntimeA2ACaller,
  isManagedRuntimeA2APeer,
  probeManagedRuntimeA2ACaller,
  readManagedRuntimeA2ATask,
  sendManagedRuntimeA2A,
} from "./managedRuntimeA2A";

const peer = {
  id: "pi-peer",
  status: "running",
  runtime_type: "pi",
  runtime_provider_key: "pi-rpc",
  runtime_contract_version: 1,
};

beforeEach(() => request.mockReset());

it("accepts only a running Pi instance with a valid persisted Runtime binding", () => {
  expect(isManagedRuntimeA2ACaller({ ...peer, status: "stopped" })).toBe(true);
  expect(isManagedRuntimeA2APeer(peer)).toBe(true);
  expect(isManagedRuntimeA2APeer({ ...peer, status: "stopped" })).toBe(false);
  expect(isManagedRuntimeA2APeer({ ...peer, runtime_provider_key: "hermes-core" })).toBe(false);
});

it("requires the Pi bridge to advertise active A2A tools before declaring the caller ready", async () => {
  request.mockResolvedValueOnce({ ok: true, json: { features: { run_submission: true, a2a_tools: true } } });
  await expect(probeManagedRuntimeA2ACaller(peer)).resolves.toMatchObject({ state: "ready", toolState: "ready" });
  request.mockResolvedValueOnce({ ok: true, json: { features: { run_submission: true } } });
  await expect(probeManagedRuntimeA2ACaller(peer)).resolves.toMatchObject({ state: "ready", toolState: "unavailable" });
});

it("translates an A2A message into a Pi run and streams mapped terminal evidence", async () => {
  request
    .mockResolvedValueOnce({ ok: true, statusCode: 201, json: { id: "session-1234" } })
    .mockResolvedValueOnce({ ok: true, statusCode: 202, json: { id: "run-12345678", status: "queued" } })
    .mockResolvedValueOnce({ ok: true, statusCode: 200, json: { id: "run-12345678", status: "completed", output: "Pi result" } });
  const response = await sendManagedRuntimeA2A(peer, {
    id: "caller-task",
    params: { message: { contextId: "ctx-room", parts: [{ text: "Review this" }] } },
  });
  const frames = await response.text();
  expect(frames).toContain('"TASK_STATE_SUBMITTED"');
  expect(frames).toContain('"TASK_STATE_COMPLETED"');
  expect(frames).toContain('"text":"Pi result"');
  expect(request.mock.calls[1][0]).toMatchObject({
    instanceId: "pi-peer",
    method: "POST",
    path: "/v1/runs",
    body: { input: "Review this", session_id: "session-1234" },
  });
  expect(request.mock.calls[1][1]).toBe(peer);
});

it("surfaces a pending Pi approval as an actionable A2A state instead of polling to timeout", async () => {
  request
    .mockResolvedValueOnce({ ok: true, statusCode: 201, json: { id: "session-1234" } })
    .mockResolvedValueOnce({ ok: true, statusCode: 202, json: { id: "run-approval", status: "queued" } })
    .mockResolvedValueOnce({ ok: true, statusCode: 200, json: { id: "run-approval", status: "waiting_for_approval", pending_approvals: [{ permission_id: "private" }] } });
  const response = await sendManagedRuntimeA2A(peer, {
    id: "caller-task",
    params: { message: { contextId: "ctx-room", parts: [{ text: "Review this" }] } },
  });
  const frames = await response.text();
  expect(frames).toContain('"TASK_STATE_AUTH_REQUIRED"');
  expect(frames).not.toContain("private");
  expect(request).toHaveBeenCalledTimes(3);
});

it("reads and cancels a managed Pi task using the same remote run id", async () => {
  request.mockResolvedValueOnce({ ok: true, statusCode: 200, json: { id: "run-12345678", status: "completed", output: "done" } });
  await expect(readManagedRuntimeA2ATask(peer, "ctx-room", "run-12345678")).resolves.toMatchObject({
    id: "run-12345678",
    contextId: "ctx-room",
    status: { state: "TASK_STATE_COMPLETED" },
  });
  request
    .mockResolvedValueOnce({ ok: true, statusCode: 202, json: { id: "run-12345678", status: "running" } })
    .mockResolvedValueOnce({ ok: true, statusCode: 200, json: { id: "run-12345678", status: "cancelled" } });
  await expect(cancelManagedRuntimeA2ATask(peer, "ctx-room", "run-12345678")).resolves.toMatchObject({
    id: "run-12345678",
    status: { state: "TASK_STATE_CANCELED" },
  });
});
