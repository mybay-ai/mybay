import { describe, expect, it } from "vitest";
import { sanitizeStep } from "./runStepSanitizer";

describe("run step sanitizer", () => {
  it("maps search steps to stable safe UI fields", () => {
    expect(sanitizeStep({
      id: "step-1",
      tool_name: "google_search",
      status: "success",
      query: "release notes",
      url: "https://example.com/result",
      file_path: "../secret",
      started_at: 100,
      completed_at: 200
    })).toEqual({
      id: "step-1",
      tool_name: "search",
      stepType: "web_search",
      status: "completed",
      title: "chatWorkspace.toolStepSearchCompleted",
      safe_summary: "chatWorkspace.toolStepSearchCompleted",
      startedAt: 100,
      completedAt: 200,
      metadata: {
        category: "search",
        query: "release notes",
        url: "https://example.com/result"
      }
    });
  });

  it("truncates custom titles with the established ellipsis behavior", () => {
    const sanitized = sanitizeStep({ id: "step-2", tool: "shell", status: "running", title: "x".repeat(121) });
    expect(sanitized.title).toBe(`${"x".repeat(120)}...`);
    expect(sanitized.tool_name).toBe("code");
  });
});

