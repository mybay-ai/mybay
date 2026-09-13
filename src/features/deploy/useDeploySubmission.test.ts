import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { useDeploySubmission } from "./useDeploySubmission";
vi.mock("../../lib/api", () => ({ api: { post: vi.fn() } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./localDeploymentRequestAdapter", () => ({ buildLocalDeploymentRequest: () => ({ path: "/api/instances", body: {}, options: {} }) }));

describe("deployment submission coordination", () => {
  beforeEach(() => vi.clearAllMocks());
  function mount(quotaBlocked = false) {
    let actions!: ReturnType<typeof useDeploySubmission>;
    const onCreated = vi.fn();
    function Harness() {
      actions = useDeploySubmission({ data: { runtime_type: "pi", channel: "web" }, quotaBlocked, quotaStatusText: "quota", isChannelAllowedForRuntime: () => true, channelRestrictionMessage: "channel", trustPermissionConfirmed: true, isPiRuntime: true, onCreated });
      return null;
    }
    renderToString(createElement(Harness));
    return { actions, onCreated };
  }
  it("coalesces consecutive submissions before a render can disable the button", async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { actions, onCreated } = mount();
    const first = actions.submit();
    await actions.submit();
    expect(api.post).toHaveBeenCalledTimes(1);
    finish({ id: "test-instance", status: "queued" });
    await first;
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
  it("does not send a deployment when quota blocks creation", async () => {
    const { actions, onCreated } = mount(true);
    await actions.submit();
    expect(api.post).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
