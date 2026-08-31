import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ssrfValidator", () => ({ checkSSRFSafe: vi.fn(async () => ({ safe: true })) }));
vi.mock("../crypto", () => ({ decrypt: (value: string) => value }));

import { generateChatCompletion, readOAuthResponsesStream } from "./llmClient";

describe("direct chat visible response contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["", " \n\t", null])("rejects an empty OpenAI-compatible answer: %j", async (content) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content, reasoning_content: "not a user-visible answer" }, finish_reason: "length" }],
      usage: { completion_tokens: 768 },
    })));

    await expect(generateChatCompletion({ provider: "custom", model: "test-model", baseUrl: "https://models.example.com/v1", apiKey: "test-key" }, {
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({ code: "LLM_EMPTY_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["anthropic", { content: [{ type: "thinking", thinking: "private reasoning" }] }],
    ["gemini", { candidates: [{ content: { parts: [{ text: "   " }] } }] }],
  ])("rejects %s responses without visible text", async (provider, payload) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload)));
    await expect(generateChatCompletion({ provider: String(provider), model: "test-model", apiKey: "test-key" }, {
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({ code: "LLM_EMPTY_RESPONSE" });
  });

  it("rejects a completed OAuth stream without output text", async () => {
    await expect(readOAuthResponsesStream(new Response(
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":12}}}\n\n',
    ))).rejects.toMatchObject({ code: "LLM_EMPTY_RESPONSE" });
  });

  it("preserves nonempty text and usage without trimming or retrying", async () => {
    const usage = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "  OK\n" } }], usage,
    })));
    await expect(generateChatCompletion({ provider: "custom", model: "test-model", baseUrl: "https://models.example.com/v1", apiKey: "test-key" }, {
      messages: [{ role: "user", content: "hello" }],
    })).resolves.toEqual({ content: "  OK\n", usage });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
