import { StructuredDoc } from "./types";

export const taskOrientedDocs: StructuredDoc[] = [
  {
    id: "deploy_instance",
    slug: "deploy-instance",
    categoryId: "deployment",
    audience: "all",
    applicableVersion: "麦贝开源版 v0.1.0-preview+",
    applicableVersionEn: "MyBay Open Source v0.1.0-preview+",
    updatedAt: "2026-08-09",
    breadcrumbLabel: { "zh-CN": "部署实例", en: "Deploy an Instance" },
    keywords: {
      "zh-CN": ["部署", "Preflight", "模型", "渠道", "资源"],
      en: ["deployment", "preflight", "model", "channel", "resources"]
    },
    content: {
      "zh-CN": {
        title: "部署一个 Agent 实例",
        summary: "从部署前检测到模型、渠道、资源和最终健康检查的完整流程。",
        sections: [
          {
            title: "先选择正确的部署场景",
            paragraphs: [
              "本机桌面使用 desktop，局域网共享使用 lan，真实域名公网访问使用 server。部署场景决定实例 URL、Docker 绑定地址和检测规则。",
              "切换场景后应重新部署已有实例，不能只修改页面显示的域名。"
            ]
          },
          {
            title: "完成 Preflight",
            paragraphs: [
              "必须通过 Docker Socket、存储、网络和内部路由鉴权检查。server 模式还要验证 Traefik、域名和 HTTPS 前置条件。",
              "internal_routing 失败通常表示 MYBAY_INTERNAL_ROUTING_SECRET 缺失、格式错误或控制面与实例配置不一致。"
            ]
          },
          {
            title: "配置实例",
            paragraphs: [
              "设置实例名称、Agent 镜像、模型供应商、模型 API Key、通讯渠道和可选技能。",
              "Web 渠道要求 8642 对话 API 就绪。Dashboard 开关控制 9119 Web 管理端，二者是独立能力。",
              "CPU、内存、磁盘和实例数量是宿主机保护值。根据本机资源调整，不要照搬云服务器规格。"
            ]
          },
          {
            title: "部署与验收",
            paragraphs: [
              "部署完成后确认容器为 Running，Web 渠道的 8642 可对话，启用 Dashboard 时 9119 可访问。",
              "再测试对话工作台、文件预览和实例 URL。失败时查看部署日志与 Agent 容器日志，不要只依赖容器 running 状态。"
            ]
          }
        ]
      },
      en: {
        title: "Deploy an Agent Instance",
        summary: "Follow the full path from preflight to model, channel, resource, and readiness checks.",
        sections: [
          {
            title: "Choose the Deployment Scenario",
            paragraphs: [
              "Use desktop on one computer, LAN for trusted local sharing, and server for real-domain public access. The scenario controls URLs, Docker bindings, and checks.",
              "Redeploy existing instances after switching scenarios; changing a displayed domain is not sufficient."
            ]
          },
          {
            title: "Complete Preflight",
            paragraphs: [
              "Docker Socket, storage, networking, and internal-routing authentication must pass. Server mode also verifies Traefik, DNS, and HTTPS prerequisites.",
              "An internal_routing failure usually means MYBAY_INTERNAL_ROUTING_SECRET is missing, malformed, or inconsistent."
            ]
          },
          {
            title: "Configure the Instance",
            paragraphs: [
              "Set the name, Agent image, model provider, model API key, communication channels, and optional skills.",
              "The Web channel requires chat on 8642. Dashboard controls the independent web service on 9119.",
              "CPU, memory, disk, and instance-count settings protect the local host. Tune them for your machine."
            ]
          },
          {
            title: "Deploy and Verify",
            paragraphs: [
              "Confirm the container is Running, port 8642 is chat-ready for Web instances, and 9119 is reachable when Dashboard is enabled.",
              "Then test chat, file preview, and the instance URL. Inspect deployment and Agent logs when checks fail."
            ]
          }
        ]
      }
    }
  },
  {
    id: "files_storage",
    slug: "files-storage",
    categoryId: "workspace",
    audience: "all",
    applicableVersion: "麦贝开源版 v0.1.0-preview+",
    applicableVersionEn: "MyBay Open Source v0.1.0-preview+",
    updatedAt: "2026-08-09",
    breadcrumbLabel: { "zh-CN": "文件与存储", en: "Files and Storage" },
    keywords: {
      "zh-CN": ["生成文件", "预览", "下载", "磁盘", "备份"],
      en: ["generated files", "preview", "download", "disk", "backup"]
    },
    content: {
      "zh-CN": {
        title: "生成文件、预览与本地存储",
        summary: "了解 Agent 文件存放位置、安全预览、下载限制和备份方式。",
        sections: [
          {
            title: "生成文件",
            paragraphs: [
              "Agent 在工作区中生成的安全文件路径会在对话消息中显示为可点击入口。支持的类型可以直接预览，其他类型可以按安全策略下载。",
              "路径必须属于当前实例工作区；服务端会阻止目录穿越和跨实例访问。"
            ]
          },
          {
            title: "敏感文件保护",
            paragraphs: [
              "禁止预览或导出 .env、私钥、凭据文件、含 Secret 的文本和不受信任压缩包。",
              "如果文件卡片不可点击，应先确认文件仍存在、类型受支持且没有触发泄密保护。"
            ]
          },
          {
            title: "容量与备份",
            paragraphs: [
              "DEFAULT_INSTANCE_DISK_MB 是本地宿主机保护默认值，不是付费配额。大量日志、依赖和生成结果都会增加 data/ 占用。",
              "删除前先下载重要交付物。升级或迁移前备份完整 data/，不要只备份 local-store.json。"
            ]
          }
        ]
      },
      en: {
        title: "Generated Files, Preview, and Local Storage",
        summary: "Understand Agent files, safe previews, download restrictions, and backup.",
        sections: [
          {
            title: "Generated Files",
            paragraphs: [
              "Safe workspace paths returned by the Agent become clickable entries in chat. Supported types open in preview; other files may be downloaded when policy permits.",
              "Paths must remain inside the current instance workspace. The server blocks traversal and cross-instance access."
            ]
          },
          {
            title: "Sensitive File Protection",
            paragraphs: [
              "Environment files, private keys, credential files, secret-bearing text, and untrusted archives cannot be previewed or exported.",
              "If a file card is unavailable, confirm that the file exists, is supported, and did not trigger leak protection."
            ]
          },
          {
            title: "Capacity and Backup",
            paragraphs: [
              "DEFAULT_INSTANCE_DISK_MB is a local host guard, not a paid quota. Logs, dependencies, and generated artifacts all grow data/.",
              "Download important deliverables before deletion. Back up the entire data/ directory before upgrades or migration."
            ]
          }
        ]
      }
    }
  },
  {
    id: "security_practices",
    slug: "security-practices",
    categoryId: "security",
    audience: "all",
    applicableVersion: "麦贝开源版 v0.1.0-preview+",
    applicableVersionEn: "MyBay Open Source v0.1.0-preview+",
    updatedAt: "2026-08-09",
    breadcrumbLabel: { "zh-CN": "安全实践", en: "Security Practices" },
    keywords: {
      "zh-CN": ["管理员", "API Key", "Docker Socket", "公网", "备份"],
      en: ["administrator", "API key", "Docker Socket", "public server", "backup"]
    },
    content: {
      "zh-CN": {
        title: "麦贝开源版安全实践",
        summary: "保护管理员会话、模型凭据、Docker Socket、实例文件和公网入口。",
        sections: [
          {
            title: "单管理员边界",
            paragraphs: [
              "开源版使用一个本地管理员账号，没有普通用户注册、邮箱验证或多租户授权模型。",
              "不要把管理员账号交给不受信任用户。公网部署使用强密码，并按需增加 VPN 或 IP 白名单。"
            ]
          },
          {
            title: "密钥与 Docker",
            paragraphs: [
              "模型凭据由 ENCRYPTION_KEY 加密；内部路由由 MYBAY_INTERNAL_ROUTING_SECRET 鉴权。这些值不得进入日志、截图或 Issue。",
              "Docker Socket 等同于高权限宿主机入口，不得通过公网 TCP 暴露，也不要挂载给不可信容器。"
            ]
          },
          {
            title: "网络与备份",
            paragraphs: [
              "desktop 只绑定 127.0.0.1；lan 只绑定指定私网 IP；server 只公开 Traefik 的 80/443。",
              "加密备份 data/ 和 .env，并保存原 ENCRYPTION_KEY。定期测试恢复流程。"
            ]
          }
        ]
      },
      en: {
        title: "Security Practices for the MyBay Open Source",
        summary: "Protect the administrator session, model credentials, Docker Socket, instance files, and public entry points.",
        sections: [
          {
            title: "Single-Administrator Boundary",
            paragraphs: [
              "The open-source edition uses one local administrator. It has no regular-user registration, email verification, or multi-tenant authorization model.",
              "Do not share the administrator account with untrusted users. Use a strong password and optional VPN or IP allowlisting for public servers."
            ]
          },
          {
            title: "Secrets and Docker",
            paragraphs: [
              "ENCRYPTION_KEY protects model credentials, and MYBAY_INTERNAL_ROUTING_SECRET authenticates internal routes. Never expose them in logs, screenshots, or issues.",
              "Docker Socket access is highly privileged. Never expose it over public TCP or mount it into untrusted containers."
            ]
          },
          {
            title: "Network and Backup",
            paragraphs: [
              "Desktop binds to 127.0.0.1, LAN binds to one private IP, and server mode exposes only Traefik on 80/443.",
              "Encrypt backups of data/ and .env, retain the original ENCRYPTION_KEY, and test recovery."
            ]
          }
        ]
      }
    }
  },
  {
    id: "error_troubleshooting",
    slug: "error-troubleshooting",
    categoryId: "faq",
    audience: "all",
    applicableVersion: "麦贝开源版 v0.1.0-preview+",
    applicableVersionEn: "MyBay Open Source v0.1.0-preview+",
    updatedAt: "2026-08-09",
    breadcrumbLabel: { "zh-CN": "错误排查", en: "Troubleshooting" },
    keywords: {
      "zh-CN": ["Permission denied", "internal_routing", "BEGIN_TURN_FAILED", "localhost", "8642"],
      en: ["Permission denied", "internal_routing", "BEGIN_TURN_FAILED", "localhost", "8642"]
    },
    content: {
      "zh-CN": {
        title: "常见错误排查",
        summary: "根据错误现象检查脚本权限、容器状态、访问地址、内部路由和对话 API。",
        sections: [
          {
            title: "脚本和控制面板",
            paragraphs: [
              "出现 quick-start.sh: Permission denied 时运行 chmod +x quick-start.sh，或使用 bash quick-start.sh。",
              "控制面板容器暂停或退出时，先运行 docker compose ps 和 docker compose logs --tail=200 mybay-local。"
            ]
          },
          {
            title: "实例 URL 无法访问",
            paragraphs: [
              "agent-xxx.localhost 只适用于 Docker 宿主机。局域网客户端必须使用 LAN 模式，公网服务器必须使用真实域名的 server 模式。",
              "切换模式后重新部署实例，否则旧 URL 和端口绑定会保留。"
            ]
          },
          {
            title: "内部路由和对话",
            paragraphs: [
              "Routing secret missing 表示 MYBAY_INTERNAL_ROUTING_SECRET 缺失或不一致，修正 .env 后重建控制面板并重新部署实例。",
              "BEGIN_TURN_FAILED 时检查实例 chat-readiness、8642 监听、API_SERVER_ENABLED、模型凭据和控制面板日志。9119 正常不能证明 8642 正常。",
              "提交 Issue 前删除 API Key、Authorization 请求头、域名和内部路由密钥。"
            ]
          }
        ]
      },
      en: {
        title: "Common Error Troubleshooting",
        summary: "Diagnose script permissions, container state, URLs, internal routing, and the chat API.",
        sections: [
          {
            title: "Script and Control Panel",
            paragraphs: [
              "For quick-start.sh: Permission denied, run chmod +x quick-start.sh or invoke bash quick-start.sh.",
              "If the control panel is paused or exited, inspect docker compose ps and docker compose logs --tail=200 mybay-local."
            ]
          },
          {
            title: "Instance URL Is Unreachable",
            paragraphs: [
              "agent-xxx.localhost works only on the Docker host. LAN clients require LAN mode, and public servers require server mode with real domains.",
              "Redeploy instances after switching modes so old URLs and bindings are replaced."
            ]
          },
          {
            title: "Internal Routing and Chat",
            paragraphs: [
              "Routing secret missing means MYBAY_INTERNAL_ROUTING_SECRET is missing or inconsistent. Fix .env, rebuild the control panel, and redeploy the instance.",
              "For BEGIN_TURN_FAILED, check chat readiness, the 8642 listener, API_SERVER_ENABLED, model credentials, and control-panel logs. A healthy 9119 does not prove chat readiness.",
              "Redact API keys, Authorization headers, domains, and routing secrets before opening an issue."
            ]
          }
        ]
      }
    }
  },
  {
    id: "runtime_spec",
    slug: "runtime-spec",
    categoryId: "deployment",
    audience: "operator",
    applicableVersion: "麦贝开源版 v0.1.0-preview+",
    applicableVersionEn: "MyBay Open Source v0.1.0-preview+",
    updatedAt: "2026-08-09",
    breadcrumbLabel: { "zh-CN": "Runtime 规范", en: "Runtime Specification" },
    keywords: {
      "zh-CN": ["mybay.runtime.yaml", "JSON Schema", "端口", "健康检查"],
      en: ["mybay.runtime.yaml", "JSON Schema", "ports", "health checks"]
    },
    content: {
      "zh-CN": {
        title: "Agent Runtime 接入规范",
        summary: "使用声明文件描述镜像、端口、健康检查、挂载和通讯渠道。",
        sections: [
          {
            title: "规范文件",
            paragraphs: [
              "运行时通过 mybay.runtime.yaml 声明能力，并使用 public/schemas/mybay.runtime.schema.json 校验。",
              "public/specs/ 下提供 Hermes 和 Pi Agent 示例。新增字段时应同步 Schema、示例、解析器和测试。"
            ]
          },
          {
            title: "端口与就绪",
            paragraphs: [
              "internal_api_port 描述对话 API，Hermes 默认使用 8642；internal_web_port 描述可选 Dashboard，Hermes 默认使用 9119。",
              "健康路径、启动超时、数据挂载和支持渠道必须与镜像实际行为一致，不能仅让 Schema 校验通过。"
            ]
          },
          {
            title: "验证",
            paragraphs: [
              "提交前运行 npm run test:schema、npm test 和 npm run build。",
              "至少验证 desktop 模式；涉及网络标签或公开 URL 时还要验证 LAN 和 server 配置生成。"
            ]
          }
        ]
      },
      en: {
        title: "Agent Runtime Specification",
        summary: "Describe images, ports, readiness checks, mounts, and communication channels declaratively.",
        sections: [
          {
            title: "Specification Files",
            paragraphs: [
              "A runtime declares capabilities in mybay.runtime.yaml and is validated by public/schemas/mybay.runtime.schema.json.",
              "Hermes and Pi examples live under public/specs/. Update the schema, examples, parser, and tests together."
            ]
          },
          {
            title: "Ports and Readiness",
            paragraphs: [
              "internal_api_port describes chat, defaulting to 8642 for Hermes. internal_web_port describes the optional Dashboard, defaulting to 9119.",
              "Health paths, startup timeouts, mounts, and channels must match actual image behavior, not merely pass schema validation."
            ]
          },
          {
            title: "Validation",
            paragraphs: [
              "Run npm run test:schema, npm test, and npm run build before submitting changes.",
              "Validate desktop mode at minimum; changes to labels or public URLs also require LAN and server configuration checks."
            ]
          }
        ]
      }
    }
  }
];
