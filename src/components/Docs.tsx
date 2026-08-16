import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { channelGuides, ChannelGuide } from "@/shared/channelGuides.registry";
import { DocsLayout, NavGroup } from "./docs/DocsLayout";
import { PlatformOverview, CreateAgent, ModelConfigGuide, CredentialGuide, InstanceManagementGuide, VersionGuide, SecurityGuide, SingleGuide, FAQ, ChannelTemplate } from "./docs/PlatformGuides";
import { DocsExternalLink, DocsCodeBlock } from "./docs/DocsUI";
import { ArrowRight, Box, Cpu, MessageSquare, Workflow, Terminal, LayoutDashboard, Settings, Layers, FileText, ShieldAlert } from "lucide-react";
import { Card } from "./ui";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getStructuredDocById } from "../data/docs/docs.registry";
import { StructuredDocRenderer } from "./docs/StructuredDocRenderer";
import { cn } from "../lib/utils";





interface GuideDocProps {
  activeGuideId?: string;
  setActiveGuideId?: (id: string) => void;
}

export function GuideDoc({ activeGuideId: propActiveId, setActiveGuideId: propSetAction }: GuideDocProps) {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language === "zh-CN";
  const [localActiveId, setLocalActiveId] = useState<string>("platform");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const activeId = propActiveId !== undefined ? propActiveId : localActiveId;
  const setActiveId = propSetAction !== undefined ? propSetAction : setLocalActiveId;

  const queryGuideId = searchParams.get("guide");

  // Sync query parameter if it is provided (only in uncontrolled standalone mode)
  useEffect(() => {
    if (propActiveId === undefined && queryGuideId) {
      setLocalActiveId(queryGuideId);
    }
  }, [queryGuideId, propActiveId]);

  const navConfigRaw = t("docs.nav", { returnObjects: true });
  const navConfig = Array.isArray(navConfigRaw) ? navConfigRaw as NavGroup[] : [];

  const structuredDoc = getStructuredDocById(activeId);
  const structuredContent = structuredDoc ? (structuredDoc.content[isZh ? "zh-CN" : "en"] || structuredDoc.content["zh-CN"]) : null;

  // Find current item metadata
  let currentGroup = navConfig[0]?.group || "Quickstart";
  let currentTitle = structuredContent ? structuredContent.title : (navConfig[0]?.items?.[0]?.title || "Platform Overview");
  let isChannelItem = false;
  
  if (activeId === "doc_not_found") {
    currentTitle = isZh ? "文档未找到" : "Document Not Found";
  } else {
    navConfig.forEach(g => {
      const item = g.items.find(i => i.id === activeId);
      if (item) {
        currentGroup = g.group;
        if (!structuredContent) {
          currentTitle = item.title;
        }
        // We know "通讯渠道接入" is index 2, or checking activeId against known channels
        if (["web_console", "feishu", "telegram", "discord", "wecom", "webhook"].includes(activeId)) {
          isChannelItem = true;
        }
      }
    });
  }

  const getBreadcrumbs = () => {
    if (activeId === "doc_not_found") {
      return [t("docs.breadcrumbsHome"), t("docs.breadcrumbsGuide"), isZh ? "出错了" : "Error", isZh ? "文档未找到" : "Document Not Found"];
    }
    return [t("docs.breadcrumbsHome"), t("docs.breadcrumbsGuide"), currentGroup, currentTitle];
  };

  const docsHomeCards = [
    {
      id: "getting_started",
      icon: Workflow,
      tone: "blue",
      title: t("docs.home.cards.quickStart.title"),
      desc: t("docs.home.cards.quickStart.desc")
    },
    {
      id: "deploy_instance",
      icon: Box,
      tone: "emerald",
      title: t("docs.home.cards.deploy.title"),
      desc: t("docs.home.cards.deploy.desc")
    },
    {
      id: "chat_workspace",
      icon: MessageSquare,
      tone: "violet",
      title: t("docs.home.cards.workspace.title"),
      desc: t("docs.home.cards.workspace.desc")
    },
    {
      id: "files_storage",
      icon: FileText,
      tone: "cyan",
      title: t("docs.home.cards.files.title"),
      desc: t("docs.home.cards.files.desc")
    },
    {
      id: "error_troubleshooting",
      icon: ShieldAlert,
      tone: "rose",
      title: t("docs.home.cards.errors.title"),
      desc: t("docs.home.cards.errors.desc")
    }
  ];

  const docsHomeToneClass: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100 group-hover:border-blue-300",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:border-emerald-300",
    violet: "bg-violet-50 text-violet-600 border-violet-100 group-hover:border-violet-300",
    amber: "bg-amber-50 text-amber-600 border-amber-100 group-hover:border-amber-300",
    cyan: "bg-cyan-50 text-cyan-600 border-cyan-100 group-hover:border-cyan-300",
    rose: "bg-rose-50 text-rose-600 border-rose-100 group-hover:border-rose-300"
  };

  const getMetaInfo = () => {
    if (activeId === "doc_not_found") {
      return [];
    }
    if (structuredDoc) {
      const audienceLabels: Record<string, Record<string, string>> = {
        "zh-CN": {
          all: "所有用户",
          owner: "实例所有者",
          admin: "管理员",
          operator: "节点运维人员"
        },
        en: {
          all: "All Users",
          owner: "Instance Owner",
          admin: "Administrator",
          operator: "Node Operator"
        }
      };

      const textLabels: Record<string, Record<string, string>> = {
        "zh-CN": {
          version: "适用版本",
          updated: "最后更新",
          audience: "面向人群"
        },
        en: {
          version: "Version",
          updated: "Updated",
          audience: "Audience"
        }
      };

      const activeAudienceLabel = audienceLabels[isZh ? "zh-CN" : "en"]?.[structuredDoc.audience] || structuredDoc.audience;

      const activeVersionLabel = isZh 
        ? structuredDoc.applicableVersion 
        : (structuredDoc.applicableVersionEn || structuredDoc.applicableVersion);

      return [
        { label: textLabels[isZh ? "zh-CN" : "en"]?.audience || "Audience", value: activeAudienceLabel },
        { label: textLabels[isZh ? "zh-CN" : "en"]?.version || "Version", value: activeVersionLabel },
        { label: textLabels[isZh ? "zh-CN" : "en"]?.updated || "Updated", value: structuredDoc.updatedAt }
      ];
    }

    if (isChannelItem) {
       const guide = channelGuides[activeId];
       if (guide) {
         let diff = t("docs.difficulties.expert");
         if (guide.difficulty === "easy") diff = t("docs.difficulties.easy");
         if (guide.difficulty === "medium") diff = t("docs.difficulties.medium");

         return [
           { label: t("docs.difficultyLabel"), value: diff },
           { label: t("docs.accessMethodLabel"), value: guide.supported ? t("docs.accessMethods.gui") : t("docs.accessMethods.env") }
         ];
       }
    } else {
      let readingTimeKey = "3";
      if (activeId === "platform" || activeId === "getting_started") {
        readingTimeKey = "5";
      } else if (activeId === "chat_workspace") {
        readingTimeKey = "7";
      }
      const targetAudienceKey = ["platform", "create_agent", "access_agent", "getting_started"].includes(activeId) 
        ? "new" 
        : "advanced";
      
      return [
        { label: t("docs.readingTime").replace("{{time}}", "0"), value: t("docs.readingTime").replace("{{time}}", readingTimeKey) },
        { label: t("docs.audienceLabel"), value: t(`docs.audiences.${targetAudienceKey}`) }
      ];
    }
    return [];
  };

  return (
    <DocsLayout 
      navConfig={navConfig}
      activeId={activeId}
      onNavigate={setActiveId}
      breadcrumbs={getBreadcrumbs()}
      title={activeId === "platform" ? t("docs.home.title") : currentTitle}
      description={activeId === "platform" ? t("docs.home.subtitle") : activeId === "doc_not_found" ? (isZh ? "文档未找到，请从左侧目录选择其他指南。" : "The requested document guide could not be found.") : (structuredContent ? structuredContent.summary : (isChannelItem && channelGuides[activeId] ? channelGuides[activeId].guideTitle : ""))}
      meta={activeId === "doc_not_found" ? [] : getMetaInfo()}
    >
      {activeId === "doc_not_found" ? (
        <div className="space-y-6 animate-fade-in text-left">
          <div className="p-6 bg-amber-50 border border-amber-100 rounded-2xl">
            <h3 className="text-lg font-bold text-amber-900 mb-2">
              {isZh ? "无法加载指定指南" : "Unable to load guide"}
            </h3>
            <p className="text-amber-800 text-sm leading-relaxed mb-4">
              {isZh 
                ? "您访问的文档 URL 包含无效或已失效的 guide 参数。请通过左侧导航栏浏览现有的技术指南。" 
                : "The document URL you accessed contains an invalid or obsolete guide parameter. Please use the sidebar to browse available guides."}
            </p>
            <div className="pt-2">
              <button
                onClick={() => {
                  setActiveId("platform");
                  navigate("/docs");
                }}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
              >
                {isZh ? "返回文档总览" : "Back to Docs Overview"} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : structuredDoc ? (
        <StructuredDocRenderer doc={structuredDoc} lang={isZh ? "zh-CN" : "en"} />
      ) : activeId === "platform" ? (
        <div className="space-y-10 animate-fade-in text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {docsHomeCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setActiveId(card.id)}
                  className="group text-left rounded-2xl border border-outline bg-surface p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                >
                  <div className="flex items-start gap-4">
                    <div className={cn("w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 transition-colors", docsHomeToneClass[card.tone])}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-content group-hover:text-blue-700 transition-colors">{card.title}</h2>
                      <p className="mt-1.5 text-sm leading-relaxed text-content-muted">{card.desc}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 shrink-0 mt-1 transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>

          <Card className="p-6 rounded-2xl border border-outline bg-surface-muted/70">
            <div className="flex items-start gap-3">
              <LayoutDashboard className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
              <div>
                <h2 className="text-lg font-bold text-content">{t("docs.home.pathTitle")}</h2>
                <p className="mt-2 text-sm text-content-secondary leading-relaxed">{t("docs.home.pathDesc")}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-[13px] font-semibold text-content-secondary">
                  <button onClick={() => setActiveId("getting_started")} className="px-3 py-1.5 rounded-lg bg-surface border border-outline hover:border-blue-300 hover:text-blue-600 transition-colors">{t("docs.home.path.quickStart")}</button>
                  <button onClick={() => setActiveId("deploy_instance")} className="px-3 py-1.5 rounded-lg bg-surface border border-outline hover:border-blue-300 hover:text-blue-600 transition-colors">{t("docs.home.path.deploy")}</button>
                  <button onClick={() => setActiveId("chat_workspace")} className="px-3 py-1.5 rounded-lg bg-surface border border-outline hover:border-blue-300 hover:text-blue-600 transition-colors">{t("docs.home.path.workspace")}</button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : !isZh ? (
        <div className="space-y-6">
          <div className="p-6 bg-blue-50/50 border border-blue-100 rounded-2xl text-left">
            <h3 className="text-lg font-bold text-blue-900 mb-2">{t("docs.appStrings.guideTitle", { title: currentTitle })}</h3>
            <p className="text-content-secondary leading-relaxed text-sm">{t("docs.appStrings.engGuideInfo").split("<strong>{{title}}</strong>").map((part, i, arr) => (<React.Fragment key={i}>{part}{i < arr.length - 1 && <strong>{currentTitle}</strong>}</React.Fragment>))}</p>
          </div>
          
          <div className="bg-surface border rounded-2xl p-6 text-left space-y-4">
            <h4 className="font-bold text-content border-b pb-2">Core Summary</h4>
            <ul className="list-disc list-inside space-y-2 text-sm text-content-secondary">
              <li><strong>Zero CLI Configuration:</strong> Deploy without manual Docker compile steps or Nginx settings.</li>
              <li><strong>Integrated Environment:</strong> Local configuration is stored safely on the current machine.</li>
              <li><strong>Webhook Tunnels:</strong> Instant connection sync with Lark (Feishu), Telegram, and Discord endpoints.</li>
            </ul>
            <div className="pt-2">
              <Link to="/app" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
                {t("docs.appStrings.goToConsole")}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 快速入口卡片 - 仅在总览页显示 */}
          {activeId === "platform" && (
            <div className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="hover:border-blue-300 hover:shadow-md transition-all cursor-pointer p-5 flex flex-col group bg-blue-50/20 border-blue-100" onClick={() => setActiveId("create_agent")}>
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                  <Box className="w-5 h-5" />
                </div>
                <h4 className="font-semibold text-content group-hover:text-blue-600 transition-colors">创建第一个 Agent</h4>
                <p className="text-sm text-content-muted mt-1 flex-1">了解完整六步快速下发流程方案</p>
              </Card>
              
              <Card className="hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer p-5 flex flex-col group" onClick={() => setActiveId("provider_choice")}>
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-500 flex items-center justify-center mb-3">
                  <Cpu className="w-5 h-5" />
                </div>
                <h4 className="font-semibold text-content group-hover:text-indigo-600 transition-colors">接入模型供应商</h4>
                <p className="text-sm text-content-muted mt-1 flex-1">了解如何对接深度求索、OpenAI 及中转商</p>
              </Card>

              <Card className="hover:border-teal-300 hover:shadow-md transition-all cursor-pointer p-5 flex flex-col group" onClick={() => setActiveId("feishu")}>
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center mb-3">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <h4 className="font-semibold text-content group-hover:text-teal-600 transition-colors">配置飞书机器人</h4>
                <p className="text-sm text-content-muted mt-1 flex-1">将智能聊天大脑装进办公软件与自建社群</p>
              </Card>
            </div>
          )}

          {activeId === "platform" && <PlatformOverview />}
          {activeId === "create_agent" && <CreateAgent />}
          
          {activeId === "access_agent" && (
            <SingleGuide 
              subtitle="部署成功后，麦贝为您提供了三种主要的交互方式，满足 Web 管理、API 开发及聊天接驳需求。"
              scenarios={["远程办公", "系统集成", "移动端对话"]}
              steps={[
                { title: "Web 独立控制台", content: "点击实例列表中的外部链接图标，即可进入为您分配的私有 Web 界面。请注意需输入 Basic Auth 凭证（默认为您在部署时填写的用户名密码）。" },
                { title: "API 端点接入", content: "通过集成网关，您可以直接使用 HTTP POST 调用 /endpoints/[Slug] 接口。接口兼容 OpenAI 格式，方便与集成。" },
                { title: "通讯渠道联动", content: "如果您在创建时配置了飞书或 Telegram，只需在对应客户端发起对话。麦贝网关会毫秒级地路由。" }
              ]}
              verification="通过浏览器成功打开 Dashboard 界面，且 API 接口返回正确的 JSON 响应。"
            />
          )}

          {activeId === "deploy_trouble" && (
            <SingleGuide 
              subtitle="如果您的实例状态长时间处于 ERROR 或 PENDING，通常是由底层资源限制或网络震荡引起。"
              scenarios={["排障碍", "稳定性自检"]}
              troubleshooting={[
                { issue: "资源配额不足 (OOM)", solution: "当前宿主机内存或 CPU 已满。麦贝为了保护物理机安全会拦截新容器拉起。请尝试调低实例资源上限或删除闲置实例。" },
                { issue: "Slug 冲突", solution: "访问路径标识符已经被其他活跃实例占用。请修改 Slug（如加随机后缀）后重新启动部署。" },
                { issue: "模型鉴权失败", solution: "Agent 启动时会执行探测。若 API Key 失效、欠费或 Base URL 不可达，容器将报错并停止。" }
              ]}
            />
          )}

          {activeId === "provider_choice" && <ModelConfigGuide />}
          {activeId === "credential_usage" && <CredentialGuide />}
          
          {activeId === "api_key_manual" && (
            <SingleGuide 
              subtitle="除了引用预存凭证，麦贝也支持在部署流程中直接填入一次性密钥，适用于临时测试场景。"
              consolePath="实例管理 → 部署新实例 → 模型配置"
              steps={[
                { title: "进入模型配置步骤", content: "在部署流程第 3 阶段，将“使用预存凭证”开关切换至 Off。" },
                { title: "录入密钥与接入点", content: "在 API Key 输入框中粘贴您的 Token。若使用中转地址，请同步填入 Base URL。该密钥会被安全地注入容器环境变量。" }
              ]}
              scenarios={["快速测试", "私有密钥"]}
            />
          )}

          {activeId === "hot_update_llm" && (
            <SingleGuide 
              subtitle="实例运行后，您可以根据业务需求动态换“脑”，无需重构实例。"
              consolePath="实例管理 → 详情 → 设置 → 模型配置"
              steps={[
                { title: "修改配置并保存", content: "直接修改模型代号、接口地址或重新选择凭证后点击“保存修改”。" },
                { title: "自动重启重载", content: "系统会同步数据库记录，并在 5-10 秒内完成容器平滑重启重载。" }
              ]}
            />
          )}

          {activeId === "llm_errors" && <FAQ />}
          
          {activeId === "webhook" && (
            <SingleGuide 
              subtitle="麦贝支持通过标准 Webhook 接收外部事件触发工作流。"
              consolePath="实例管理 → 详情 → 技能管理"
              scenarios={["自动化集成", "CI/CD 联动"]}
              steps={[
                { title: "开启 Webhook 技能", content: "进入实例的“技能管理”页面，找到 Webhook 模块并勾选。保存配置待容器重载。" },
                { title: "获取回调地址", content: "系统会在仪表盘中分配唯一的 Endpoint URL，您可将其填向 GitHub 或其他 SaaS 的回调设置中。" }
              ]}
              officialLinks={[
                { title: "Webhooks 指南", href: "https://docs.github.com/en/webhooks" }
              ]}
            />
          )}

          {(activeId === "instance_status" || activeId === "health_chain" || activeId === "logs_排错" || activeId === "lifecycle_ops" || activeId === "basic_auth") && (
            <InstanceManagementGuide />
          )}

          {(activeId === "runtime_versions" || activeId === "image_registry" || activeId === "image_prewarm" || activeId === "instance_upgrade") && (
            <VersionGuide />
          )}

          {(activeId === "resource_limits" || activeId === "security_skills" || activeId === "credential_security" || activeId === "network_isolation") && (
            <SecurityGuide />
          )}

          {activeId === "faq" && <FAQ />}
          
          {isChannelItem && <ChannelTemplate guideId={activeId} />}
        </>
      )}

      {/* 底部导航 */}
      <div className="mt-12 pt-6 border-t border-outline">
         <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-content-muted">
           <span>{t("docs.appStrings.needMoreHelp")}</span>
           <button onClick={() => setActiveId("faq")} className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
             {t("docs.appStrings.viewKnowledgeBase")} <ArrowRight className="w-4 h-4" />
           </button>
         </div>
      </div>
    </DocsLayout>
  );
}

