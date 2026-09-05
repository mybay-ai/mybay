import { describe, expect, it } from "vitest";
import { buildHermesModelConfig, resolveHermesProvider, VALID_HERMES_PROVIDERS } from "./providerEnv";

describe("Qwen Hermes runtime mapping", () => {
  it("maps DashScope Qwen to the native Alibaba runtime", () => {
    expect(resolveHermesProvider("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1"))
      .toBe("alibaba");
    expect(VALID_HERMES_PROVIDERS.has(resolveHermesProvider("qwen"))).toBe(true);
  });

  it("injects the credential and regional endpoint expected by the Alibaba runtime", () => {
    const result = buildHermesModelConfig({
      provider: "qwen",
      model: "qwen3.8-flash",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-test-qwen",
    });

    expect(result.hermesProvider).toBe("alibaba");
    expect(result.apiKeyEnvName).toBe("DASHSCOPE_API_KEY");
    expect(result.envVars).toMatchObject({
      HERMES_MODEL_PROVIDER: "alibaba",
      DASHSCOPE_API_KEY: "sk-test-qwen",
      DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    });
    expect(result.envVars.OPENAI_API_KEY).toBeUndefined();
  });
});

describe("Hermes provider compatibility", () => {
  it.each([
    {
      provider: "anthropic",
      model: "claude-fable-5.1",
      apiKey: "sk-test-anthropic",
      hermesProvider: "anthropic",
      apiKeyEnvName: "ANTHROPIC_API_KEY"
    },
    {
      provider: "openrouter",
      model: "openai/gpt-6-astra",
      apiKey: "sk-test-openrouter",
      hermesProvider: "openrouter",
      apiKeyEnvName: "OPENROUTER_API_KEY"
    }
  ])("passes $model through the $provider deployment config", ({ provider, model, apiKey, hermesProvider, apiKeyEnvName }) => {
    const result = buildHermesModelConfig({ provider, model, apiKey });

    expect(result.hermesProvider).toBe(hermesProvider);
    expect(result.apiKeyEnvName).toBe(apiKeyEnvName);
    expect(result.envVars).toMatchObject({
      HERMES_MODEL_PROVIDER: hermesProvider,
      HERMES_MODEL: model,
      [apiKeyEnvName]: apiKey
    });
    expect(result.configYaml.model).toMatchObject({ provider: hermesProvider, default: model });
  });

  it("maps Together AI to the provider id supported by the runtime image", () => {
    expect(resolveHermesProvider("together")).toBe("togetherai");
    expect(VALID_HERMES_PROVIDERS.has(resolveHermesProvider("together"))).toBe(true);
  });

  it("accepts the runtime-native OAuth providers without inventing API-key variables", () => {
    for (const provider of ["openai-codex", "xai-oauth"]) {
      const result = buildHermesModelConfig({ provider, model: "test-model", apiKey: "structured-oauth-payload" });
      expect(result.hermesProvider).toBe(provider);
      expect(result.apiKeyEnvName).toBe("");
      expect(result.envVars.HERMES_API_KEY_ENV_NAME).toBeUndefined();
      expect(result.envVars[""]).toBeUndefined();
      expect(result.envVars.PROVIDER_API_KEY).toBeUndefined();
      expect(VALID_HERMES_PROVIDERS.has(result.hermesProvider)).toBe(true);
    }
  });

  it("writes a named Hermes provider for a custom OpenAI-compatible endpoint", () => {
    const result = buildHermesModelConfig({
      provider: "custom-openai-compatible",
      model: "my-model",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "custom-test-key"
    });

    expect(result.hermesProvider).toBe("custom-openai-compatible");
    expect(result.configYaml).toMatchObject({
      model: { provider: "custom-openai-compatible", default: "my-model" },
      providers: {
        "custom-openai-compatible": {
          base_url: "https://llm.example.test/v1",
          key_env: "OPENAI_API_KEY",
          api_mode: "chat_completions",
          default_model: "my-model"
        }
      }
    });
  });
});
