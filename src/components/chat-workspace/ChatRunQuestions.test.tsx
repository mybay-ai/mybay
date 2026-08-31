import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuestionCard } from "./ChatRunQuestions";
import type { LocalRunQuestion } from "../../../shared/localRunQuestions";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const question: LocalRunQuestion = { id: "q", runId: "r", conversationId: "c", spec: { title: "<script>untrusted</script>", multiple: false, allowCustom: true, options: [{ id: "a", label: "A" }] }, status: "pending", answer: null, createdAt: "", expiresAt: "", resolvedAt: null };
describe("structured question card", () => {
  it("escapes runtime text, renders single/custom input and disables stale answers", () => {
    const html = renderToStaticMarkup(<QuestionCard question={question} enabled={false} onAnswer={async () => {}} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('type="radio"');
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('maxLength="2000"');
  });
  it("renders multiple choices and restores a read-only answer", () => {
    expect(renderToStaticMarkup(<QuestionCard question={{ ...question, spec: { ...question.spec, multiple: true } }} enabled onAnswer={async () => {}} />)).toContain('type="checkbox"');
    const html = renderToStaticMarkup(<QuestionCard question={{ ...question, status: "answered", answer: { selected: ["a"], custom: "中文回答" } }} enabled onAnswer={async () => {}} />);
    expect(html).toContain("中文回答");
    expect(html).not.toContain("<button");
  });
});
