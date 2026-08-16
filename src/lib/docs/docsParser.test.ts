import { describe, expect, it } from "vitest";
import { extractHeadings, markdownToPlainText, parseMarkdownDocument } from "./docsParser";

describe("docs Markdown parser", () => {
  it("parses required frontmatter and keyword lists", () => {
    const doc = parseMarkdownDocument(`---
title: Getting started
description: Install and launch MyBay.
updatedAt: 2026-08-14
keywords:
  - install
  - launch
---
## Install

Run **MyBay**.`);

    expect(doc.frontmatter).toEqual({
      title: "Getting started",
      description: "Install and launch MyBay.",
      updatedAt: "2026-08-14",
      keywords: ["install", "launch"],
    });
    expect(doc.headings).toEqual([{ id: "install", text: "Install", level: 2 }]);
    expect(doc.plainText).toContain("Run MyBay");
  });

  it("creates deterministic duplicate anchors and ignores fenced headings", () => {
    const headings = extractHeadings(`## 配置模型
### 配置模型
\`\`\`md
## Not a heading
\`\`\`
## API Key`);

    expect(headings.map(heading => heading.id)).toEqual(["配置模型", "配置模型-2", "api-key"]);
  });

  it("removes callout markers while retaining their searchable text", () => {
    expect(markdownToPlainText(`> [!WARNING]\n> Never expose an API key.`)).toBe("Never expose an API key.");
  });

  it("rejects invalid metadata", () => {
    expect(() => parseMarkdownDocument("---\ntitle: Missing description\n---\nBody"))
      .toThrow("description");
    expect(() => parseMarkdownDocument("---\ntitle: A\ndescription: B\nupdatedAt: today\n---\nBody"))
      .toThrow("YYYY-MM-DD");
  });
});
