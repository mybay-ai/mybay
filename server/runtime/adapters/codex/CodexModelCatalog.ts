import { providerRegistry } from "../../../../shared/providerRegistry";

// Metadata follows DeepSeek's Codex integration guide, not its example system prompt.
export function buildDeepSeekCodexModelCatalog() {
  return { models: providerRegistry.deepseek.models.map((slug, index) => ({
    slug, display_name: slug, description: "DeepSeek model",
    priority: index + 1, visibility: "list", supported_in_api: true,
    minimal_client_version: "0.144.0", upgrade: null, availability_nux: null,
    default_reasoning_level: "high",
    supported_reasoning_levels: ["low", "high", "max"].map(effort => ({ effort, description: effort })),
    shell_type: "shell_command", apply_patch_tool_type: "freeform",
    prefer_websockets: false, web_search_tool_type: "text",
    supports_parallel_tool_calls: true, supports_search_tool: true,
    supports_reasoning_summaries: false, default_reasoning_summary: "none",
    reasoning_summary_format: "experimental",
    support_verbosity: true, default_verbosity: "low",
    input_modalities: slug.includes("vision") ? ["text", "image"] : ["text"],
    supports_image_detail_original: slug.includes("vision"),
    context_window: 1048576, max_context_window: 1048576,
    effective_context_window_percent: 95, auto_compact_token_limit: null,
    truncation_policy: { mode: "tokens", limit: 10000 },
    experimental_supported_tools: [], default_service_tier: null,
    tool_mode: null, multi_agent_version: "v2", use_responses_lite: false,
    include_skills_usage_instructions: false, auto_review_model_override: null,
    base_instructions: "You are a coding assistant. Complete the user's task using available tools. Respect requested scope and report results accurately.",
  })) };
}
