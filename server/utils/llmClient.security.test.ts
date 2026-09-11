import { describe, expect, it, vi } from "vitest";

vi.mock("../crypto", () => ({ decrypt: (value: string) => value }));

import { generateChatCompletion, generateText } from "./llmClient";

const privateEndpoint = {
  provider: "custom-openai-compatible",
  model: "local-model",
  baseUrl: "http://127.0.0.1:8080/v1",
  apiKey: "test-key",
};

describe("LLM client outbound request policy", () => {
  it("rejects a private chat-completions endpoint", async () => {
    await expect(generateChatCompletion(privateEndpoint, {
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({ code: "LLM_BASE_URL_UNSAFE" });
  });

  it("rejects a private text-generation endpoint", async () => {
    await expect(generateText(privateEndpoint, {
      prompt: "hello",
    })).rejects.toMatchObject({ code: "LLM_BASE_URL_UNSAFE" });
  });
});
