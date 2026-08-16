import { describe, expect, it } from "vitest";
import { evaluateWorkflowReadiness, getTemplateProductionPolicy, selectInitialExecutionTasks } from "./productionPolicy";
import { buildWorkflowReadinessContext } from "../services/workflowReadinessService";

describe("local template production policy", () => {
  it("classifies the eight built-in workflows honestly", () => {
    expect(getTemplateProductionPolicy("xiaohongshu-topic-generator").capability_level).toBe("production");
    expect(getTemplateProductionPolicy("lead-form-auto-reply").capability_level).toBe("beta");
    expect(getTemplateProductionPolicy("daily-news-briefing").capability_level).toBe("demo");
  });

  it("evaluates real local save shapes for all workflows", () => {
    expect(evaluateWorkflowReadiness({ id: "xiaohongshu-topic-generator" }, buildWorkflowReadinessContext({ template_inputs: { niche: "AI 工具" } })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "short-video-script-analyzer" }, buildWorkflowReadinessContext({ workflow_inputs: { script_text: "产品脚本" } })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "daily-news-briefing" }, buildWorkflowReadinessContext({ businessConfig: { industryKeyword: "人工智能" } })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "competitor-price-monitor" }, buildWorkflowReadinessContext({ businessConfig: { competitorUrls: ["https://example.com/p"] } })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "lead-form-auto-reply" }, buildWorkflowReadinessContext({ webhookSecret: "encrypted-secret" })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "ecommerce-order-alert" }, buildWorkflowReadinessContext({ webhook_secret: "encrypted-secret" })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "feishu-message-summary" }, buildWorkflowReadinessContext({ feishuAppId: "cli_test", feishuAppSecret: "encrypted-secret" })).ready).toBe(true);
    expect(evaluateWorkflowReadiness({ id: "pdf-summary" }, buildWorkflowReadinessContext({}, [{ name: "report.pdf", mimeType: "application/pdf" }])).ready).toBe(true);
  });

  it("blocks missing file and authorization requirements", () => {
    expect(evaluateWorkflowReadiness({ id: "pdf-summary" }, buildWorkflowReadinessContext({})).state).toBe("file_required");
    expect(evaluateWorkflowReadiness({ id: "feishu-message-summary" }, buildWorkflowReadinessContext({ feishuAppId: "cli_only" })).state).toBe("authorization_required");
  });

  it("creates at most one executable initial task", () => {
    expect(selectInitialExecutionTasks([{ id: 1 }, { id: 2 }, { id: 3 }])).toEqual([{ id: 1 }]);
  });
});
