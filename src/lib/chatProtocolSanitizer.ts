const DSML_TOOL_CALL_PATTERNS = [
  /<\s*[｜|]?\s*DSML\s*[｜|]?\s*tool_calls\s*>/i,
  /<\s*[｜|]?\s*DSML\s*[｜|]?\s*invoke\b/i,
  /<\s*tool_calls?\s*>/i,
  /<\s*function_call\s*>/i
];

export function containsToolCallProtocol(value: string | null | undefined): boolean {
  const text = String(value || "");
  return DSML_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(text));
}

export function sanitizeChatDisplayContent(value: string | null | undefined, fallback: string): string {
  const text = String(value || "");
  if (!text) return text;
  return containsToolCallProtocol(text) ? fallback : text;
}
