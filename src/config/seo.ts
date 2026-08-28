export interface SEOMeta {
  title: string;
  description: string;
  canonical?: string;
  noindex?: boolean;
}

export const SITE_CONFIG = {
  name: "麦贝 MyBayAI",
  url: import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_MYBAY_PLATFORM_ORIGIN || "http://localhost:3000",
  defaultDescription: "麦贝开源版（MyBay Open Source） 是面向本地与私有部署的 Self-hosted AI Agent Control Plane，支持 Docker Agent、BYOK、日志监控和多渠道接入。",
};

export const SEO_CONFIG: Record<string, SEOMeta> = {
  "/": {
    title: "麦贝开源版（MyBay Open Source） - 本地部署 AI Agent",
    description: "麦贝开源版（MyBay Open Source） 提供 Local-first 的 AI Agent 控制平面，支持 Docker 私有部署、BYOK、日志监控和飞书、Telegram、Discord、微信等多渠道接入。",
  },
  "/features": {
    title: "功能特性 - 麦贝 MyBayAI",
    description: "了解麦贝的一键部署、实例隔离、API Key 加密托管、日志监控、一键升级和多渠道 Agent 接入能力。",
  },
  "/models": {
    title: "模型与供应商 - 麦贝 MyBayAI",
    description: "麦贝 MyBayAI 支持多种大模型供应商配置，让 Agent 智能体可灵活接入，支持 OpenAI、DeepSeek、Gemini、OpenRouter 等主流模型服务。",
  },
  "/docs": {
    title: "使用文档 - 麦贝 MyBayAI",
    description: "查看麦贝使用文档，了解如何部署 Hermes Agent、配置模型、连接飞书、Telegram、Discord、微信和 QQBot 等渠道。",
  },
  "/docs/getting-started": {
    title: "快速上手麦贝平台 - 使用文档 - 麦贝 MyBayAI",
    description: "完成本地初始化、配置模型凭证并拉起第一个 AI Agent 独立容器实例。",
  },
  "/docs/chat-workspace": {
    title: "对话工作台架构解析与异常诊断 - 使用文档 - 麦贝 MyBayAI",
    description: "深入理解对话工作台的通信架构，揭秘 8642、9119 端口职能以及在各种网络/渠道配置下的健康度就绪逻辑。",
  },

  "/contact": {
    title: "联系我们 - 麦贝 MyBayAI ",
    description: "Contact us for technical support, deployment help, business cooperation, and enterprise AI Agent solutions.",
  },
  "/changelog": {
    title: "麦贝开源版更新日志",
    description: "查看麦贝开源版 v0.1.24 已发布并验证的稳定版能力。",
  },
  "/privacy": {
    title: "麦贝开源版隐私说明",
    description: "了解麦贝开源版的本地优先存储、对话历史持久化、第三方数据传输和自托管责任边界。",
  },
  "/terms": {
    title: "麦贝开源版使用条款",
    description: "查看麦贝开源版的 AGPL-3.0-only 许可、自托管安全责任、第三方服务与商业许可边界。",
  },
  "/security": {
    title: "安全与漏洞披露 - 麦贝 MyBayAI",
    description: "了解麦贝当前实施的数据保护、身份认证、访问控制、速率限制和基础设施安全措施，以及负责任的漏洞报告方式。",
  },
  // Auth & Private Pages (noindex)
  "/login": {
    title: "登录 - 麦贝 MyBayAI",
    description: "登录本地控制台管理您的 AI Agent 实例。",
    noindex: true,
  },
  "/register": {
    title: "本地初始化 - 麦贝开源版（MyBay Open Source）",
    description: "初始化本地管理员并开始部署私有 AI Agent。",
    noindex: true,
  },
  "/app": {
    title: "控制台 - 麦贝 MyBayAI",
    description: "管理您的 AI Agent 实例、监控运行状态和日志。",
    noindex: true,
  },
  "/app/instances": {
    title: "实例列表 - 麦贝 MyBayAI",
    description: "查看和管理您所有的 AI Agent 部署实例。",
    noindex: true,
  },
  "/app/deploy": {
    title: "部署新实例 - 麦贝 MyBayAI",
    description: "快速配置并部署一个新的 Agent 实例。",
    noindex: true,
  },
  "/app/templates": {
    title: "模板中心 - 麦贝 MyBayAI",
    description: "选择最适合您业务场景的 AI 智能体模板开始运行。",
    noindex: true,
  },
  "/app/credentials": {
    title: "凭证管理 - 麦贝 MyBayAI",
    description: "安全管理您的 API Key 和平台对接凭证。",
    noindex: true,
  },
  "/app/guides": {
    title: "部署指南 - 麦贝 MyBayAI",
    description: "获取针对不同平台的 Agent 部署与对接指南。",
    noindex: true,
  },
};
