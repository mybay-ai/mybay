import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeOutboundFetch = vi.hoisted(() => vi.fn());

vi.mock("../services/system/systemNetworkPolicy", () => ({ safeOutboundFetch }));

import { generateChatCompletion, readOAuthResponsesStream } from "./llmClient";

function oauthCredential() {
  return JSON.stringify({
    account_id: "account-1",
    tokens: { access_token: "oauth-access", refresh_token: "oauth-refresh" },
  });
}

describe("OAuth direct chat", () => {
  beforeEach(() => safeOutboundFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("parses Responses API SSE output", async () => {
    const response = new Response([
      'data: {"type":"response.output_text.delta","delta":"你"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"好"}\n\n',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
    ].join(""), { headers: { "Content-Type": "text/event-stream" } });
    await expect(readOAuthResponsesStream(response)).resolves.toEqual({
      content: "你好",
      usage: { input_tokens: 2, output_tokens: 1 },
    });
  });

  it("uses the OAuth access token and Responses transport for Codex", async () => {
    const fetchMock = safeOutboundFetch.mockResolvedValue(new Response(
      'data: {"type":"response.output_text.done","text":"ok"}\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    ));

    const result = await generateChatCompletion({
      provider: "openai-codex",
      model: "gpt-5.5",
      providerApiKey: oauthCredential(),
    }, { messages: [{ role: "user", content: "hello" }] });

    expect(result.content).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer oauth-access",
      "ChatGPT-Account-Id": "account-1",
      Accept: "text/event-stream",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-5.5", stream: true, store: false });
  });

  it("classifies an expired Codex OAuth response without exposing the upstream body as an API key error", async () => {
    safeOutboundFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "token expired" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ));

    await expect(generateChatCompletion({
      provider: "openai-codex",
      model: "gpt-5.5",
      providerApiKey: oauthCredential(),
    }, { messages: [{ role: "user", content: "hello" }] })).rejects.toMatchObject({
      code: "CODEX_AUTH_REQUIRED",
      statusCode: 401,
    });
  });

  it("refreshes an expired Codex access token once, persists rotation, and retries the response", async () => {
    const fetchMock = safeOutboundFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "expired" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response('data: {"type":"response.output_text.done","text":"restored"}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));
    const refreshFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "oauth-access-2",
        refresh_token: "oauth-refresh-2",
        id_token: "oauth-id-2",
        expires_in: 3600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onOAuthRefresh = vi.fn(async () => undefined);

    const result = await generateChatCompletion({
      provider: "openai-codex",
      model: "gpt-5.5",
      providerApiKey: oauthCredential(),
      onOAuthRefresh,
    }, { messages: [{ role: "user", content: "hello" }] });

    expect(result.content).toBe("restored");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshFetch).toHaveBeenCalledTimes(1);
    expect(String(refreshFetch.mock.calls[0][0])).toBe("https://auth.openai.com/oauth/token");
    expect(String(refreshFetch.mock.calls[0][1]?.body)).toContain("grant_type=refresh_token");
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer oauth-access-2" });
    expect(onOAuthRefresh).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({ access_token: "oauth-access-2", refresh_token: "oauth-refresh-2" }),
    }));
  });
});
