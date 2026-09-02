import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import zh from "../../locales/zh-CN/dashboard/base.json";
import { InstanceTable } from "./InstanceTable";

async function renderTable() {
  const instanceI18n = i18n.createInstance();
  await instanceI18n.use(initReactI18next).init({
    lng: "zh-CN",
    fallbackLng: "zh-CN",
    interpolation: { escapeValue: false },
    resources: { "zh-CN": { dashboard: zh } },
  });
  return renderToStaticMarkup(
    <I18nextProvider i18n={instanceI18n}>
      <InstanceTable
        instances={[{
          id: "6d131ba2-e803-4684-b5f2-c0ab63b4ef97",
          name: "web",
          status: "running",
          url: "http://agent.localhost",
          archived: false,
          configSummary: { channel: "web", channelLabel: "WEB" },
        } as any]}
        viewMode="table"
        activeLogs={null}
        setActiveLogs={vi.fn()}
        setDetailTab={vi.fn()}
        currentUser={{ id: "user", role: "admin" } as any}
        handleExportConfig={vi.fn()}
        handleDelete={vi.fn()}
        handleArchive={vi.fn()}
        handleRestore={vi.fn()}
        handleInstanceAction={vi.fn()}
        handleOpenLink={vi.fn()}
        setEditingInstance={vi.fn()}
        fetchInstances={vi.fn()}
        onRenameInstance={vi.fn()}
        onViewGuide={vi.fn()}
        handleOpenTerminalView={vi.fn()}
        selectedInstanceIds={new Set()}
        onSelectInstance={vi.fn()}
        onSelectAll={vi.fn()}
        allSelected={false}
        deletingIds={new Set()}
        actioningIds={new Set()}
      />
    </I18nextProvider>,
  );
}

describe("InstanceTable desktop layout", () => {
  it("uses a fixed responsive table and consolidates secondary actions", async () => {
    const html = await renderTable();
    expect(html).toContain("table-fixed");
    expect(html).not.toContain("min-w-[1120px]");
    expect(html).toContain('aria-label="更多: web"');
    expect(html).toContain("6d131ba2…ef97");
    expect(html).toContain('title="6d131ba2-e803-4684-b5f2-c0ab63b4ef97"');
    expect(html).toContain('<option value="settings">参数配置</option>');
    expect(html).toContain('<option value="delete">注销</option>');
  });
});
