import { describe, expect, it, vi } from "vitest";
import { readWorkspaceAttachments, workspaceAttachmentIssue, type WorkspaceAttachmentEntry } from "./workspaceAttachmentSource";

const file: WorkspaceAttachmentEntry = { name: "说明.txt", path: "/outputs/说明.txt", type: "file", size: 3, mime: "text/plain" };
function setup(overrides: Partial<Parameters<typeof readWorkspaceAttachments>[0]> = {}) {
  return { instanceId: "agent-a", entries: [file], extensions: [".txt"], maxBytes: 10, remaining: 2,
    signal: new AbortController().signal, onProgress: vi.fn(), get: vi.fn(async () => new Response("abc", { headers: { "content-type": "text/plain" } })), ...overrides };
}
describe("workspace attachment copy boundary", () => {
  it("copies bytes using the selected instance and encoded virtual path, deduplicating paths", async () => {
    const options = setup({ entries: [file, file] });
    const copied = await readWorkspaceAttachments(options);
    expect(options.get).toHaveBeenCalledExactlyOnceWith("/api/instances/agent-a/files/download?path=%2Foutputs%2F%E8%AF%B4%E6%98%8E.txt", { signal: options.signal });
    expect(copied).toHaveLength(1);
    expect(copied[0].name).toBe("说明.txt");
    expect(await copied[0].text()).toBe("abc");
  });
  it.each([
    [{ ...file, isSymlink: true }, "workspaceAttachLink"],
    [{ ...file, size: 0 }, "workspaceAttachEmpty"],
    [{ ...file, size: 11 }, "workspaceAttachSize"],
    [{ ...file, name: "image.png" }, "workspaceAttachType"],
  ] as const)("rejects unavailable entries before requesting bytes %#", async (entry, reason) => {
    const options = setup({ entries: [entry] });
    await expect(readWorkspaceAttachments(options)).rejects.toThrow(reason);
    expect(options.get).not.toHaveBeenCalled();
  });
  it("enforces the remaining slot count before reading", async () => {
    const options = setup({ remaining: 0 });
    await expect(readWorkspaceAttachments(options)).rejects.toThrow("workspaceAttachCount");
    expect(options.get).not.toHaveBeenCalled();
  });
  it("checks streamed bytes even when the file grew since listing", async () => {
    await expect(readWorkspaceAttachments(setup({ get: vi.fn(async () => new Response("a".repeat(11))) }))).rejects.toThrow("workspaceAttachSize");
  });
  it("does not turn an access-denied response into an attachment", async () => {
    await expect(readWorkspaceAttachments(setup({ get: vi.fn(async () => new Response("denied", { status: 403 })) }))).rejects.toThrow("workspaceAttachReadFailed");
  });
  it("never returns files after cancellation, even if a transport ignores the abort", async () => {
    const controller = new AbortController();
    const options = setup({ signal: controller.signal, get: vi.fn(async () => { controller.abort(); return new Response("abc"); }) });
    await expect(readWorkspaceAttachments(options)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("supports unrestricted configuration but still rejects empty data", async () => {
    expect(workspaceAttachmentIssue({ ...file, name: "app.js" }, null, null)).toBeNull();
    expect(workspaceAttachmentIssue({ ...file, name: "LICENSE" }, null, null)).toBeNull();
    expect(workspaceAttachmentIssue({ ...file, name: "LICENSE" }, [".txt"], null)).toBe("workspaceAttachType");
    const copied = await readWorkspaceAttachments(setup({ extensions: null, maxBytes: null, remaining: null }));
    expect(copied[0].size).toBe(3);
    await expect(readWorkspaceAttachments(setup({ get: vi.fn(async () => new Response("")) }))).rejects.toThrow("workspaceAttachEmpty");
  });
});
