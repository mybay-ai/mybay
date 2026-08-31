import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../locales/en/dashboard/chatWorkspace.json";
import zh from "../../locales/zh-CN/dashboard/chatWorkspace.json";
import { ChatInputBar } from "./ChatInputBar";
import { handleLongTextPaste } from "./ChatLongTextCards";

async function renderInput(options: { text?: string; input?: string; ready?: boolean; uploading?: boolean; creating?: boolean; language?: string } = {}) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: options.language || "en", interpolation: { escapeValue: false }, resources: {
    en: { dashboard: { chatWorkspace: en } }, "zh-CN": { dashboard: { chatWorkspace: zh } },
  } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatInputBar
    input={options.input || ""} longTextComposer={{ blocks: [{ id: "a", leadingText: "", content: options.text ?? "MATERIAL" }], insert: vi.fn(), update: vi.fn(), unfold: vi.fn() }}
    attachmentConfig={{ allowedExtensions: null, maxFiles: null, maxFileSizeBytes: 1024 } as any}
    sending={false} activeRunId={null} isChatReady={options.ready ?? true} isUploading={options.uploading} creatingConversation={options.creating}
    selectedChannel="web" chatMode="quick" onChatModeChange={vi.fn()} reasoningEffort="balanced" onReasoningEffortChange={vi.fn()}
    agentAvailable agentCapabilityState="supported" onInputChange={vi.fn()} onSubmit={vi.fn()} onKeyDown={vi.fn()} onStopRun={vi.fn()}
  /></I18nextProvider>);
}

describe("long-text composer rendering", () => {
  it.each(["en", "zh-CN"])("renders translated, accessible cards and enables card-only send (%s)", async language => {
    const html = await renderInput({ language });
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('type="submit" disabled');
    expect(html).not.toContain("chatWorkspace.longText");
    expect(html).toContain(language === "en" ? "Expand or collapse long text 1" : "展开或收起长文本 1");
  });
  it("escapes pasted HTML and never interprets it", async () => {
    const html = await renderInput({ text: '<img src=x onerror="alert(1)"><script>bad()</script>' });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });
  it.each([{ text: " \n " }, { ready: false }, { uploading: true }, { creating: true }, { text: "🙂".repeat(20001) }])("blocks unavailable or invalid submission %#", async options => {
    expect(await renderInput(options)).toContain('type="submit" disabled');
  });
  it("counts the combined draft and displays the existing limit warning", async () => {
    const html = await renderInput({ text: "🙂".repeat(20000), input: "X" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("20,000");
    expect(html).toContain('type="submit" disabled');
  });
});

describe("long-text clipboard handling", () => {
  afterEach(() => vi.unstubAllGlobals());
  function clipboard(text: string, files: unknown[] = []) {
    return {
      clipboardData: { getData: vi.fn(() => text), files }, preventDefault: vi.fn(),
      currentTarget: { selectionStart: 2, selectionEnd: 5, isConnected: true, focus: vi.fn(), setSelectionRange: vi.fn() },
    };
  }
  it("intercepts long plain text at the selection and restores cursor to the suffix", () => {
    vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => callback() });
    const event = clipboard("x".repeat(1500));
    const insert = vi.fn();
    expect(handleLongTextPaste(event as any, insert, "existing-card")).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith("x".repeat(1500), 2, 5, "existing-card");
    expect(event.currentTarget.setSelectionRange).toHaveBeenCalledWith(0, 0);
  });
  it.each([["short", []], ["x".repeat(1500), [{}]]])("leaves short and file paste untouched %#", (text, files) => {
    const event = clipboard(text as string, files as unknown[]);
    const insert = vi.fn();
    expect(handleLongTextPaste(event as any, insert)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
