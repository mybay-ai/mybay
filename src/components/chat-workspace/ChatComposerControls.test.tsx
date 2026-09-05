import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../locales/en/dashboard/chatWorkspace.json";
import zh from "../../locales/zh-CN/dashboard/chatWorkspace.json";
import { ChatComposerControls } from "./ChatComposerControls";

// Keyboard, focus and popup interaction are verified in the local browser.
describe("composer selection presentation", () => {
  it.each([
    ["zh-CN", "agent", "balanced", "Agent · 均衡"],
    ["en", "quick", "fast", "Direct · Fast"],
    ["zh-CN", "assist", "deep", "助理模式 · 深度"],
  ] as const)("retains the full accessible selection in %s / %s", async (language, mode, effort, label) => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({ lng: language, resources: {
      en: { dashboard: { chatWorkspace: en } }, "zh-CN": { dashboard: { chatWorkspace: zh } },
    } });
    const onChatModeChange = vi.fn(), onUpload = vi.fn();
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ChatComposerControls
      chatMode={mode} reasoningEffort={effort} agentAvailable={false} agentUnavailableMessage="Unavailable"
      onChatModeChange={onChatModeChange} onReasoningEffortChange={vi.fn()}
      attachmentCount={2} attachmentConfig={{ maxFiles: null, maxFileSizeBytes: null, allowedExtensions: null }}
      uploadExtensions={null} isUploading={false} canUpload={false} attachmentDisabledReason="Unavailable" onUpload={onUpload}
    /></I18nextProvider>);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain("dashboard:chatWorkspace.");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(onChatModeChange).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });
});
