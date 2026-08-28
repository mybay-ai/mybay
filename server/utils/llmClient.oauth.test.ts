import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ssrfValidator", () => ({ checkSSRFSafe: vi.fn(async () => ({ safe: true })) }));

import { generateChatCompletion, readOAuthResponsesStream } from "./llmClient";

function oauthCredential() {
  return JSON.stringify({
    account_id: "account-1",
    tokens: { access_token: "oauth-access", refresh_token: "oauth-refresh" },
  });
}

describe("OAuth direct chat", () => {
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
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
});
