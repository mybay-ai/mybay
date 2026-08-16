import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/auth", () => ({ getAuthToken: () => "chat-test-token" }));

import { api } from "../../lib/api";

const hookSource = readFileSync(new URL("./useChatWorkspaceFiles.ts", import.meta.url), "utf8");
const fileCases = [
  { label: "JSON", mime: "application/json", body: '{"hello":"world"}' },
  { label: "PNG", mime: "image/png", body: new Uint8Array([137, 80, 78, 71]) },
  { label: "PDF", mime: "application/pdf", body: "%PDF-1.7" },
  { label: "TXT", mime: "text/plain", body: "plain text" }
] as const;

describe("Chat Workspace raw file response contract", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  for (const testCase of fileCases) {
    it(`keeps ${testCase.label} files as raw Response objects`, async () => {
      const rawResponse = new Response(testCase.body, { status: 200, headers: { "Content-Type": testCase.mime } });
      const jsonSpy = vi.spyOn(rawResponse, "json");
      fetchMock.mockResolvedValue(rawResponse);

      const response = await api.downloadChatFile("instance-1", "conversation-1", "file-1", "inline");
      const blob = await response.blob();

      expect(response).toBe(rawResponse);
      expect(blob.type).toBe(testCase.mime);
      expect(blob.size).toBeGreaterThan(0);
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  }

  it("rejects a JSON error before the workspace reads it as a file", async () => {
    const response = new Response(JSON.stringify({ error: "forbidden" }), { status: 403, statusText: "Forbidden", headers: { "Content-Type": "application/json" } });
    const blobSpy = vi.spyOn(response, "blob");
    fetchMock.mockResolvedValue(response);

    await expect(api.downloadChatFile("instance-1", "conversation-1", "file-1", "inline"))
      .rejects.toMatchObject({ status: 403 });
    expect(blobSpy).not.toHaveBeenCalled();
  });

  it("keeps normal business JSON parsing unchanged", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(api.get<{ success: boolean }>("/api/business-json")).resolves.toEqual({ success: true });
  });

  it("uses typed raw methods at both blob-reading call sites", () => {
    expect(hookSource).toContain("api.getRaw(");
    expect(hookSource).toContain('api.downloadChatFile(capturedInstanceId, capturedConversationId, file.id, "inline", { signal: request.signal })');
    expect(hookSource).not.toContain("as Response");
  });
});