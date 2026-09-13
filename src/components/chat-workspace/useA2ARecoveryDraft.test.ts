import { beforeEach, describe, expect, it, vi } from "vitest";
import { useA2ARecoveryDraft } from "./useA2ARecoveryDraft";

const effects = vi.hoisted(() => [] as Array<() => void>);
const route = vi.hoisted(() => ({ key: "route-a", pathname: "/app/chat", search: "?instanceId=instance-a", hash: "", state: null as any }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => void) => effects.push(effect),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("react-router-dom", () => ({ useLocation: () => route, useNavigate: () => navigate }));

function options() {
  return {
    selectedId: "instance-a",
    setInput: vi.fn(),
    setChatMode: vi.fn(),
    modePreference: { remember: vi.fn() },
    showToast: vi.fn(),
  };
}

describe("A2A recovery draft", () => {
  beforeEach(() => {
    effects.length = 0;
    vi.clearAllMocks();
    route.key = "route-a";
    route.state = null;
  });

  it("consumes a matching navigation draft once", () => {
    route.state = {
      a2aRetryDraft: "retry peer",
      a2aRetryInstanceId: "instance-a",
      a2aRecoverySource: { contextId: "context-a", taskId: "task-a", peerId: "peer-a" },
    };
    const input = options();
    const result = useA2ARecoveryDraft(input);
    effects[0]();

    expect(result.recoveryDraftRef.current?.a2aRetryDraft).toBe("retry peer");
    expect(input.setInput).toHaveBeenCalledWith("retry peer");
    expect(input.setChatMode).toHaveBeenCalledWith("agent");
    expect(input.modePreference.remember).toHaveBeenCalledWith("instance-a", "agent");
    expect(navigate).toHaveBeenCalledWith("/app/chat?instanceId=instance-a", { replace: true, state: null });

    effects[0]();
    expect(input.setInput).toHaveBeenCalledTimes(1);
  });

  it("links group recovery and clears the link for a missing member draft", () => {
    const input = options();
    const result = useA2ARecoveryDraft(input);
    result.prepareGroupRecovery({
      peerId: "peer-a",
      contextId: "context-a",
      taskId: "task-a",
      status: "failed",
      requestText: "inspect failure",
      summary: "",
    } as any);
    expect(result.recoveryDraftRef.current?.a2aRecoverySource).toEqual({ contextId: "context-a", taskId: "task-a", peerId: "peer-a" });
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.groupRunRecoveryPrepared", "success");

    result.prepareMissingGroupMember({ peerName: "Pi", peerId: "peer-b", contextId: "context-a", requestText: "continue" } as any);
    expect(result.recoveryDraftRef.current).toBeNull();
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.groupRunMissingPrepared", "success");
  });
});
