import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileDiffLines } from "./ChatFileDiff";

describe("file diff rendering", () => {
  it("renders executable HTML and scripts as escaped text", () => {
    const html = renderToStaticMarkup(<FileDiffLines file={{ path: "test.html", before: "<script>alert(1)</script>", after: '<img src=x onerror="alert(2)">' }} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("−");
    expect(html).toContain("+");
  });
});
