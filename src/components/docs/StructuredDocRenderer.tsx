import React from "react";
import { StructuredDoc } from "../../data/docs/types";
import { DocsCallout, DocsStep, DocsCodeBlock } from "./DocsUI";

interface StructuredDocRendererProps {
  doc: StructuredDoc;
  lang: "zh-CN" | "en";
}

export function StructuredDocRenderer({ doc, lang }: StructuredDocRendererProps) {
  const content = doc.content[lang] || doc.content["zh-CN"];

  return (
    <div className="space-y-10 animate-fade-in text-left">
      {/* Main Content Sections */}
      <div className="space-y-12">
        {content.sections.map((section, idx) => {
          // Generate a clean ID for the TOC scroll spy from the title
          const cleanId = `section-${idx}-${section.title
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9\u4e00-\u9fa5_-]/g, "")}`;

          return (
            <section key={idx} className="space-y-5">
              <h2 id={cleanId} className="text-2xl font-bold text-content tracking-tight border-b border-outline pb-2 mt-4">
                {section.title}
              </h2>

              <div className="space-y-4">
                {section.paragraphs.map((para, pIdx) => (
                  <p key={pIdx} className="text-content-secondary text-base leading-relaxed font-normal">
                    {para}
                  </p>
                ))}
              </div>

              {section.callout && (
                <DocsCallout
                  type={section.callout.type === "danger" ? "error" : section.callout.type}
                  title={section.callout.title}
                >
                  {section.callout.text}
                </DocsCallout>
              )}

              {section.steps && section.steps.length > 0 && (
                <div className="space-y-6 my-6">
                  {section.steps.map((step, sIdx) => (
                    <DocsStep key={sIdx} step={sIdx + 1} title={step.title}>
                      {step.content}
                    </DocsStep>
                  ))}
                </div>
              )}

              {section.codeBlock && (
                <DocsCodeBlock
                  code={section.codeBlock.code}
                  language={section.codeBlock.language}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
