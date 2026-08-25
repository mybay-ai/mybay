import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkSSRFSafe = vi.hoisted(() => vi.fn());

vi.mock("./ssrfValidator", () => ({ checkSSRFSafe }));
vi.mock("../crypto", () => ({ decrypt: (value: string) => value }));

import { generateChatCompletion, generateText } from "./llmClient";

describe("LLM client outbound request policy", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    checkSSRFSafe.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("blocks chat completion before fetch when the final endpoint is unsafe", async () => {
    checkSSRFSafe.mockResolvedValue({ safe: false, error: "private address" });

    await expect(generateChatCompletion({
      provider: "custom-openai-compatible",
      model: "local-model",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "test-key"
    }, {
      messages: [{ role: "user", content: "hello" }]
    })).rejects.toMatchObject({ code: "LLM_BASE_URL_UNSAFE" });

    expect(checkSSRFSafe).toHaveBeenCalledWith("http://127.0.0.1:8080/v1/chat/completions");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks text generation before fetch when the final endpoint is unsafe", async () => {
    checkSSRFSafe.mockResolvedValue({ safe: false, error: "private address" });

    await expect(generateText({
      provider: "custom-openai-compatible",
      model: "local-model",
      baseUrl: "http://127.0.0.1:8080/v1",
      apiKey: "test-key"
    }, {
      prompt: "hello"
    })).rejects.toMatchObject({ code: "LLM_BASE_URL_UNSAFE" });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the existing provider request contract for a safe endpoint", async () => {
    checkSSRFSafe.mockResolvedValue({ safe: true });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "OK" } }] })
    } as Response);

    await expect(generateChatCompletion({
      provider: "custom-openai-compatible",
      model: "public-model",
      baseUrl: "https://models.example.com/v1",
      apiKey: "test-key"
    }, {
      messages: [{ role: "user", content: "hello" }]
    })).resolves.toMatchObject({ content: "OK" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://models.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST", redirect: "manual" })
    );
  });
});
