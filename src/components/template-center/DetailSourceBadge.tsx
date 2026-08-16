import React from "react";
import { useTranslation } from "react-i18next";
import { isFullyDatabaseContent } from "./utils";

interface DetailSourceBadgeProps {
  item: any;
}

export function DetailSourceBadge({ item }: DetailSourceBadgeProps) {
  const { t } = useTranslation("dashboard");

  if (isFullyDatabaseContent(item)) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        {t("template_center.modal.source_db", "当前内容来源：数据库已发布内容")}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
      {t("template_center.modal.source_static", "当前部分内容仍使用静态兜底，建议在模板管理台补齐")}
    </span>
  );
}

