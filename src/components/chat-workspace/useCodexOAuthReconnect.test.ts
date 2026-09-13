import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useCodexOAuthReconnect } from "./useCodexOAuthReconnect";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const oauth = vi.hoisted(() => ({
  loading: false,
  error: "",
  connect: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  session: null,
  options: null as any,
}));

vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));
vi.mock("../../features/deploy/useProviderOAuth", () => ({
  useProviderOAuth: vi.fn((options: unknown) => {
    oauth.options = options;
    return oauth;
  }),
}));
vi.mock("../../lib/api", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

function options(runtimeType = "codex", authMode = "chatgpt") {
  return {
    selectedId: "codex-a",
    selectedInstance: { id: "codex-a", name: "Codex", runtime_type: runtimeType, codexAuthMode: authMode } as any,
    setInstances: vi.fn(),
    setChatReadiness: vi.fn(),
    showToast: vi.fn(),
    t: ((key: string) => key) as any,
  };
}

describe("Codex OAuth reconnect", () => {
  beforeEach(() => {
    effects.length = 0;
    vi.clearAllMocks();
    oauth.loading = false;
    oauth.error = "";
    oauth.options = null;
  });

  it("does not connect non-OAuth instances", () => {
    const input = options("codex", "api");
    const result = useCodexOAuthReconnect(input);
    expect(result.isCodexAccountInstance).toBe(false);
    result.handleReconnectCodexOAuth();
    expect(oauth.connect).not.toHaveBeenCalled();
  });

  it("binds the credential to the instance selected when reconnect begins", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    vi.mocked(api.get).mockResolvedValue({ ready: true, runtimeReady: true, sendable: true });
    const input = options();
    const result = useCodexOAuthReconnect(input);
    result.handleReconnectCodexOAuth();
    expect(oauth.connect).toHaveBeenCalledTimes(1);

    await oauth.options.onComplete({ id: "credential-a" });
    expect(api.post).toHaveBeenCalledWith("/api/instances/codex-a/codex-oauth", { credentialId: "credential-a" });
    const updateInstances = vi.mocked(input.setInstances).mock.calls[0][0] as (instances: any[]) => any[];
    expect(updateInstances([{ id: "codex-a", configSummary: {} }])[0]).toMatchObject({
      model_provider: "openai-codex",
      configSummary: { provider: "openai", providerCredentialId: "credential-a" },
    });
    const updateReadiness = vi.mocked(input.setChatReadiness).mock.calls[0][0] as (state: any) => any;
    expect(updateReadiness({})["codex-a"]).toMatchObject({ ready: true, probeStatus: "checked" });
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.codexOAuthReconnected", "success");
  });

  it("surfaces provider OAuth errors through the chat feedback", () => {
    oauth.error = "popup failed";
    const input = options();
    useCodexOAuthReconnect(input);
    effects[0]();
    expect(input.showToast).toHaveBeenCalledWith("dashboard:chatWorkspace.codexOAuthReconnectFailed", "error");
  });
});
