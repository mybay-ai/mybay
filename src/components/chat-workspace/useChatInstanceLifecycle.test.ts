import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useChatInstanceLifecycle } from "./useChatInstanceLifecycle";
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../lib/api", () => ({ api: { get: vi.fn() } }));
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}
function options(selectedId = "") {
  return { userId: "user-a", preferredInstanceId: "", selectedId, selectedIdRef: { current: selectedId }, instanceGenerationRef: { current: 1 }, getRememberedInstanceId: () => "", selectInstanceId: vi.fn(), setInstances: vi.fn(), setLoadingInstances: vi.fn(), setChatReadiness: vi.fn(), setError: vi.fn(), loadConversationsForSelectedInstance: vi.fn(async () => {}) };
}
describe("instance lifecycle request isolation", () => {
  beforeEach(() => { effects.length = 0; vi.clearAllMocks(); });
  it("discards the previous user's instance response after cleanup", async () => {
    const request = deferred();
    vi.mocked(api.get).mockReturnValue(request.promise);
    const input = options();
    useChatInstanceLifecycle(input);
    const cleanup = effects[0]();
    expect(typeof cleanup).toBe("function");
    if (cleanup) cleanup();
    request.resolve([{ id: "old-instance", status: "running" }]);
    await request.promise;
    expect(input.setInstances).not.toHaveBeenCalled();
    expect(input.selectInstanceId).toHaveBeenCalledTimes(1);
    expect(input.selectInstanceId).toHaveBeenCalledWith("");
  });
  it("loads local history without waiting for the runtime probe", async () => {
    const request = deferred();
    vi.mocked(api.get).mockReturnValue(request.promise);
    const input = options("instance-a");
    useChatInstanceLifecycle(input);
    const cleanup = effects[1]();
    expect(input.loadConversationsForSelectedInstance).toHaveBeenCalledWith("instance-a", 1, expect.any(AbortSignal));
    input.instanceGenerationRef.current = 2;
    request.resolve({ ready: true });
    await request.promise;
    expect(input.setChatReadiness).not.toHaveBeenCalled();
    if (cleanup) cleanup();
  });
  it("aborts the selected instance probe on cleanup", async () => {
    const request = deferred();
    vi.mocked(api.get).mockReturnValue(request.promise);
    const input = options("instance-a");
    useChatInstanceLifecycle(input);
    const cleanup = effects[1]();
    if (cleanup) cleanup();
    const signal = vi.mocked(api.get).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
    request.resolve({ ready: true });
    await request.promise;
    expect(input.setChatReadiness).not.toHaveBeenCalled();
  });
});
