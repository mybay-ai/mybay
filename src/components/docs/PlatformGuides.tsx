import React from "react";
import { DocsCallout, DocsStep, DocsCodeBlock, DocsTroubleshoot, DocsSectionTemplate, DocsExternalLink, DocsInternalLink } from "./DocsUI";
import { Activity, ShieldCheck, ExternalLink, Key, MessageSquare, Bot, Globe, Zap, Settings, Search, FileText, Code } from "lucide-react";
import { Card } from "../ui";
import { channelGuides } from "@/shared/channelGuides.registry";

export function PlatformOverview() {
  return (
    <DocsSectionTemplate
      subtitle="欢迎使用麦贝 AI Agent 托管与部署平台。本指南将帮助您快速理解平台架构，并开启您的智能代理运维之旅。"
      scenarios={["平台初探", "自检运维", "架构理解"]}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
        <Card className="p-6 border-blue-100 bg-blue-50/20 shadow-sm">
          <h4 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
            <Activity className="size-5 text-blue-600" />
            系统自检说明
          </h4>
          <p className="text-sm text-content-secondary leading-relaxed">
            平台会持续监控底层 Docker 引擎及 Nginx 网关状态。如果您发现实例无法拉起，请优先检查“系统状态”看板，确认 Runtime 服务是否在线。
          </p>
        </Card>
        <Card className="p-6 border-emerald-100 bg-emerald-50/20 shadow-sm">
          <h4 className="font-bold text-emerald-900 mb-2 flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-600" />
            安全隔离设计
          </h4>
          <p className="text-sm text-content-secondary leading-relaxed">
            每一个由麦贝部署的 Agent 实例都运行在独立的容器沙箱中，具备物理级别的资源限制与网络隔离，双重加密保障您的 API Key 不会泄露。
          </p>
        </Card>
      </div>

      <DocsCallout type="info" title="快速上手提示">
        建议先在 <DocsInternalLink to="/credentials">凭证管理</DocsInternalLink> 中预存您的模型 API Key，这将极大简化后续的部署流程。
      </DocsCallout>
    </DocsSectionTemplate>
  );
}

export function CreateAgent() {
  return (
    <DocsSectionTemplate
      subtitle="通过引导式向导，您可以在 30 秒内完成一个具备独立 API 端点和 Web 控制台的 Agent 部署。"
      consolePath="实例管理 → 部署新实例"
      scenarios={["初次部署", "新建环境"]}
      steps={[
        {
          title: "填写实例基础信息",
          content: (
            <div className="space-y-2">
              <p>输入实例名称（如：行业调研助手）和访问路径（Slug）。</p>
              <DocsCallout type="warning">
                Slug 必须是全英文或数字，且在您的账户下唯一。这将生成您的私有访问地址。
              </DocsCallout>
            </div>
          )
        },
        {
          title: "选择 Runtime 版本",
          content: "推荐使用标注为 LATEST 的镜像版本。如果您需要保持特定业务稳定性，也可以选择固定的版本号。"
        },
        {
          title: "配置模型大脑",
          content: (
            <div className="space-y-2">
              <p>选择模型供应商并填入 API Key。您可以参考下面的供应商文档：</p>
              <div className="flex flex-wrap gap-3 mt-2">
                <DocsExternalLink href="https://platform.openai.com/">OpenAI ↗</DocsExternalLink>
                <DocsExternalLink href="https://platform.deepseek.com/">DeepSeek ↗</DocsExternalLink>
                <DocsExternalLink href="https://aistudio.google.com/">Google AI Studio ↗</DocsExternalLink>
              </div>
            </div>
          )
        },
        {
          title: "选择通讯渠道与技能",
          content: "开启 Web 控制台，并可选关联飞书、Telegram 等渠道。根据需求开关 Tavily 搜索等高级技能。"
        }
      ]}
      verification="部署完成后，实例状态应显示为“运行中 (Running)”，且健康检查链路各节点均为绿色。"
      officialLinks={[
        { title: "实例列表控制台", href: "/instances" },
        { title: "新建部署向导", href: "/instances/create" }
      ]}
    />
  );
}

export function ChannelTemplate({ guideId }: { guideId: string }) {
  const guide = channelGuides[guideId];
  if (!guide) return (
    <div className="text-center py-20 bg-surface-muted rounded-3xl border-2 border-dashed border-outline">
      <Bot className="size-12 text-slate-300 mx-auto mb-4" />
      <h3 className="text-content font-bold text-lg">暂无该渠道的详细指南 (ID: {guideId})</h3>
      <p className="text-content-muted text-sm mt-1">这可能是因为该渠道尚未在您的 Runtime 版本中完全启用。</p>
    </div>
  );

  const getOfficialLinks = () => {
    switch (guideId) {
      case "feishu":
        return [
          { title: "飞书开放平台", href: "https://open.feishu.cn" },
          { title: "飞书自建应用创建指南", href: "https://open.feishu.cn/document/home/introduction-to-custom-app-development/introduction-to-app-development" },
          { title: "事件订阅配置说明", href: "https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/introduction" }
        ];
      case "telegram":
        return [
          { title: "Telegram BotFather", href: "https://t.me/botfather" },
          { title: "Telegram Bot API 文档", href: "https://core.telegram.org/bots/api" }
        ];
      case "discord":
        return [
          { title: "Discord Developer Portal", href: "https://discord.com/developers/applications" },
          { title: "Discord Bot 权限设置说明", href: "https://discord.com/developers/docs/topics/permissions" }
        ];
      case "wecom":
        return [
          { title: "企业微信服务商后台", href: "https://work.weixin.qq.com" },
          { title: "自建应用回调配置", href: "https://developer.work.weixin.qq.com/document/path/90666" }
        ];
      default:
        return [];
    }
  };

  return (
    <DocsSectionTemplate
      subtitle={guide.description}
      consolePath="实例管理 → 选择实例 → 配置修改 → 接驳通讯聊天渠道"
      prerequisites={guide.requiredFields}
      steps={guide.setupSteps?.map((s, i) => ({ title: `配置步骤 ${i + 1}`, content: s }))}
      verification="对应的渠道网关日志显示 'Connected'，且在第三方客户端发送消息能收到 Agent 回复。"
      officialLinks={getOfficialLinks()}
    />
  );
}

export function ModelConfigGuide() {
  return (
    <DocsSectionTemplate
      subtitle="麦贝支持多厂商模型动态切换，确保您的 Agent 始终拥有最强的大脑。"
      scenarios={["厂商切换", "接入点调整", "自定义模型"]}
      steps={[
        {
          title: "选择 Provider 与 Model",
          content: (
            <div className="space-y-2">
              <p>Provider 决定了通讯协议（如 OpenAI, Gemini, Claude），Model 决定了具体的模型版本。</p>
              <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-blue-400">
                # 典型配置示例<br/>
                Provider: SiliconFlow<br/>
                Model: deepseek-ai/DeepSeek-V3
              </div>
            </div>
          )
        },
        {
          title: "Base URL 的作用",
          content: "当您使用转发服务或在中转站部署时，可以修改 Base URL 绕过网络限制。官方地址通常已内置。"
        },
        {
          title: "自定义模型名 / 接入点 ID",
          content: "对于硅基流动、SiliconFlow 等需要特定 ID 的场景，开启自定义模式并手动填写对应的模型字符串。"
        }
      ]}
      troubleshooting={[
        { issue: "API Key 提示不正确", solution: "检查是否带了多余的空格，或当前 Key 余额是否充足。" },
        { issue: "连接超时", solution: "尝试更换 Base URL 或确认宿主机是否能正常访问该模型厂商的 API。" }
      ]}
      officialLinks={[
        { title: "OpenAI 控制台", href: "https://platform.openai.com/" },
        { title: "DeepSeek 控制台", href: "https://platform.deepseek.com/" },
        { title: "SiliconFlow 硅基流动", href: "https://siliconflow.cn/" },
        { title: "阿里云百炼 (Qwen)", href: "https://bailian.console.aliyun.com/" },
        { title: "火山引擎 (DeepSeek/Doubao)", href: "https://www.volcengine.com/product/ark" }
      ]}
    />
  );
}

export function CredentialGuide() {
  return (
    <DocsSectionTemplate
      subtitle="预存凭证允许您在多个 Agent 实例间共享同一套模型配置，避免重复填写 API Key。"
      consolePath="凭证管理 → 新增凭证"
      steps={[
        {
          title: "创建预存凭证",
          content: "在凭证管理页面预先录入 OpenAI 或 DeepSeek 的密钥。这些密钥会加密存储。"
        },
        {
          title: "在部署流程中引用",
          content: "部署向导第三步可直接下拉选择已有的凭证，系统会自动完成关联。"
        },
        {
          title: "更新凭证",
          content: "当您在凭证管理修改 Key 后，所有引用该凭证的操作都将自动同步，无需逐个修改实例。"
        }
      ]}
      officialLinks={[
        { title: "前往凭证管理", href: "/credentials" }
      ]}
    />
  );
}

export function InstanceManagementGuide() {
  return (
    <DocsSectionTemplate
      subtitle="麦贝提供了全生命周期的实例运维工具，涵盖健康监控、日志审计及配置热更新。"
      consolePath="实例管理 → 实例列表"
      steps={[
        {
          title: "理解健康监测链路",
          content: (
            <div className="space-y-2">
              <p>链路包含：Internal Port (容器监听)、Supervised (监控守护)、Proxy (网关配置)、Reconciler (状态对齐)。</p>
              <DocsCallout type="info">
                如果 Proxy 为红，通常意味着您的 Slug 存在冲突或 Nginx 配置正在同步中。
              </DocsCallout>
            </div>
          )
        },
        {
          title: "配置修改（热更新）",
          content: "无需删除实例，直接在“设置”中修改环境变量。保存后系统会自动执行重启冷却流程，平滑更新容器配置。"
        },
        {
          title: "重启与自愈",
          content: "如果容器因 OOM（内存溢出）崩溃，麦贝守护进程会每隔 15 秒重新拉起，确保服务高可用。"
        }
      ]}
    />
  );
}

export function VersionGuide() {
  return (
    <DocsSectionTemplate
      subtitle="麦贝采用镜像订阅机制，您可以灵活选择稳定版或尝试最新的研发版本。"
      consolePath="镜像与版本 → 运行环境 (Runtime)"
      steps={[
        {
          title: "镜像预热机制",
          content: "为了确保存储层不被击穿，管理员可以预热最新的 Latest 镜像。预热完成后，用户创建新实例即可实现一秒冷启动。"
        },
        {
          title: "版本升级建议",
          content: "推荐在业务低谷期点击“升级至最新版”。麦贝会保留您原有的 /data 卷，仅替换运行代码层。"
        }
      ]}
    />
  );
}

export function SecurityGuide() {
  return (
    <DocsSectionTemplate
      subtitle="安全是麦贝平台的核心底色。我们从三个维度保障您的 Agent 资产安全。"
      consolePath="系统设置 → 安全与合规"
      steps={[
        {
          title: "Basic Auth 访问边界",
          content: (
            <div className="space-y-2">
              <p>所有 Agent Web 控制台强制启用 HTTP Basic Auth，通过用户名密码拦截未授权的爬虫与访问。</p>
              <DocsCallout type="warning" title="重要提醒">
                请不要在公共网络环境下将 Basic Auth 密码设置为 123456 等简单组合。
              </DocsCallout>
            </div>
          )
        },
        {
          title: "高危技能权限管控",
          content: "SQL 执行、文件写入、系统 Shell 等技能默认关闭。若需开启，请在“技能”管理中明确授权。"
        }
      ]}
    />
  );
}

export function SingleGuide({ title, subtitle, steps, troubleshooting, officialLinks, consolePath, scenarios, prerequisites, verification }: any) {
  return (
    <DocsSectionTemplate
      subtitle={subtitle}
      steps={steps}
      troubleshooting={troubleshooting}
      officialLinks={officialLinks}
      consolePath={consolePath}
      scenarios={scenarios}
      prerequisites={prerequisites}
      verification={verification}
    />
  );
}

export function FAQ() {
  return (
    <DocsSectionTemplate
      subtitle="这里汇总了最常遇到的部署与运行问题，帮助您快速定位根因。"
    >
      <div className="space-y-4">
        <DocsTroubleshoot 
          issue="如何知道我的 Agent 部署失败了？"
          solution="查看实例列表，若显示为“ERROR”或“STOPPED”，点击“运行日志”筛选 ERROR 级别输出，通常能看到 API Key 失效或端口冲突提示。"
        />
        <DocsTroubleshoot 
          issue="飞书消息发了，Agent 没回？"
          solution={
            <div className="space-y-1">
              <p>1. 确认实例正在运行 (Running)；</p>
              <p>2. 确认健康检查链路中 Feishu 节点为绿；</p>
              <p>3. 检查飞书应用的 Allowed Users 是否包含您的 ID；</p>
              <p>4. 确认您的飞书应用是否已发布版本且机器人选项已开启。</p>
            </div>
          }
        />
        <DocsTroubleshoot 
          issue="修改配置后需要多久生效？"
          solution="保存配置后，镜像会重新加载环境变量并重启容器，大约需要 5-10 秒。期间网关会暂时返回 502，这是正常重载现象。"
        />
      </div>
    </DocsSectionTemplate>
  );
}
