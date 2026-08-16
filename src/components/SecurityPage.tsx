import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileWarning,
  Gauge,
  KeyRound,
  LockKeyhole,
  Mail,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

type SecurityCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  backHome: string;
  practicesTitle: string;
  reportTitle: string;
  reportDescription: string;
  reportButton: string;
  securityTxt: string;
  reportingGuideTitle: string;
  reportingGuide: string[];
  boundariesTitle: string;
  boundaries: string[];
  note: string;
  cards: Array<{ title: string; description: string; points: string[] }>;
};

const COPY: Record<"zh" | "en", SecurityCopy> = {
  zh: {
    eyebrow: "安全与漏洞披露",
    title: "以可验证的措施保护平台与用户数据",
    subtitle: "MyBay 将安全控制贯穿凭证存储、身份认证、实例隔离和运行监测。以下内容说明当前已经实施的防护措施，以及负责任的漏洞报告方式。",
    backHome: "返回首页",
    practicesTitle: "当前安全实践",
    reportTitle: "发现安全问题？",
    reportDescription: "请通过专用安全邮箱联系我们。请勿在公开渠道提交漏洞细节、访问令牌、API Key 或用户数据。",
    reportButton: "发送安全报告",
    securityTxt: "查看 security.txt",
    reportingGuideTitle: "报告建议包含",
    reportingGuide: [
      "受影响的页面、接口或功能，以及可复现的步骤",
      "潜在影响与必要的概念验证；请对敏感数据进行脱敏",
      "便于我们安全联系你的邮箱，以及可选的修复建议",
    ],
    boundariesTitle: "负责任测试边界",
    boundaries: [
      "仅测试你拥有或已获得明确授权的账号与实例",
      "不要访问、修改或下载其他用户的数据",
      "不要执行拒绝服务、社会工程、垃圾信息或破坏性测试",
    ],
    note: "安全措施用于持续降低风险，但任何系统都无法承诺绝对安全。我们会根据平台演进持续审查和改进这些控制。",
    cards: [
      {
        title: "数据与凭证保护",
        description: "降低敏感配置在存储和传输过程中的暴露风险。",
        points: [
          "平台凭证及实例敏感配置采用 AES-256-GCM 加密后存储",
          "生产流量通过 HTTPS/TLS 传输",
          "受保护 API 响应使用 no-store 等策略禁止浏览器和边缘缓存",
        ],
      },
      {
        title: "身份与访问控制",
        description: "依据身份、角色、邮箱状态及资源所有权保护受限操作。",
        points: [
          "用户数据、实例、凭证和管理接口执行身份认证与权限校验",
          "公开接口与受保护接口分离，并按用途实施独立校验",
          "MyBay Open Source 关闭公开注册，并使用 HttpOnly Cookie 保护单管理员登录会话",
        ],
      },
      {
        title: "滥用与暴力破解防护",
        description: "敏感入口实施分层速率限制，降低自动化攻击风险。",
        points: [
          "登录请求当前限制为同一来源与账号组合 15 分钟最多 10 次",
          "密码重置按来源 IP 和目标邮箱分别实施频率限制",
          "实例操作、对话和高风险写入接口均设有针对性限流",
        ],
      },
      {
        title: "基础设施与浏览器防护",
        description: "从网络入口、响应策略和容器边界实施纵深防护。",
        points: [
          "启用 CSP、HSTS、X-Frame-Options、nosniff 与 Permissions-Policy",
          "显式拦截 .env、.git 等敏感路径，并隐藏其存在性",
          "实例容器、存储目录和内部路由按实例身份进行隔离与校验",
        ],
      },
    ],
  },
  en: {
    eyebrow: "Security & Vulnerability Disclosure",
    title: "Verifiable safeguards for the platform and user data",
    subtitle: "MyBay applies security controls across credential storage, authentication, instance isolation, and runtime monitoring. This page describes safeguards currently in place and how to report vulnerabilities responsibly.",
    backHome: "Back to home",
    practicesTitle: "Security practices",
    reportTitle: "Found a security issue?",
    reportDescription: "Contact us through the dedicated security mailbox. Do not submit vulnerability details, access tokens, API keys, or user data through public channels.",
    reportButton: "Email a security report",
    securityTxt: "View security.txt",
    reportingGuideTitle: "Please include",
    reportingGuide: [
      "The affected page, endpoint, or feature and reproducible steps",
      "Potential impact and a minimal proof of concept with sensitive data removed",
      "A safe contact address and, optionally, a suggested remediation",
    ],
    boundariesTitle: "Responsible testing boundaries",
    boundaries: [
      "Test only accounts and instances you own or are explicitly authorized to assess",
      "Do not access, modify, or download another user's data",
      "Do not perform denial-of-service, social engineering, spam, or destructive testing",
    ],
    note: "Security controls reduce risk but no system can promise absolute security. We review and improve these safeguards as the platform evolves.",
    cards: [
      {
        title: "Data and credential protection",
        description: "Reducing exposure of sensitive configuration at rest and in transit.",
        points: [
          "Platform credentials and sensitive instance configuration are stored using AES-256-GCM encryption",
          "Production traffic is transported over HTTPS/TLS",
          "Protected API responses use no-store controls to prevent browser and edge caching",
        ],
      },
      {
        title: "Identity and access control",
        description: "Restricted operations are protected by identity, role, verification, and resource ownership checks.",
        points: [
          "User data, instance, credential, and administrative APIs enforce authentication and authorization",
          "Public endpoints are separated from protected endpoints and validated for their specific purpose",
          "MyBay Open Source disables public registration and protects the single-admin session with an HttpOnly cookie",
        ],
      },
      {
        title: "Abuse and brute-force protection",
        description: "Layered rate limits protect sensitive entry points from automated abuse.",
        points: [
          "Login is currently limited to 10 attempts per 15-minute window for a source and account combination",
          "Password reset is limited independently by source IP and target email address",
          "Instance actions, chat, and sensitive write endpoints use purpose-specific limits",
        ],
      },
      {
        title: "Infrastructure and browser safeguards",
        description: "Defense in depth across ingress, response policy, and container boundaries.",
        points: [
          "CSP, HSTS, X-Frame-Options, nosniff, and Permissions-Policy headers are enabled",
          "Sensitive paths such as .env and .git are explicitly blocked without disclosing their presence",
          "Instance containers, storage directories, and internal routes are isolated and validated by instance identity",
        ],
      },
    ],
  },
};

const CARD_ICONS = [LockKeyhole, KeyRound, Gauge, ServerCog];

export default function SecurityPage() {
  const { i18n } = useTranslation();
  const copy = COPY[i18n.language.toLowerCase().startsWith("zh") ? "zh" : "en"];

  return (
    <div className="min-h-screen bg-[#f7f9fc]" data-page="security">
      <section
        className="relative overflow-hidden border-b border-blue-900/60 px-6 pb-24 pt-32 text-white sm:px-8"
        style={{ background: "radial-gradient(circle at 50% 10%, rgba(59,130,246,.28), transparent 36%), linear-gradient(135deg,#070d20 0%,#101b3d 52%,#101f4c 100%)" }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(#ffffff22_1px,transparent_1px)] [background-size:20px_20px]" />
        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <Link to="/" className="mb-8 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-200 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />{copy.backHome}
          </Link>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-300/20 bg-blue-400/10 text-blue-200 shadow-2xl shadow-blue-950/40">
            <ShieldCheck className="h-8 w-8" />
          </motion.div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-300">{copy.eyebrow}</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-3xl font-bold tracking-tight sm:text-5xl">{copy.title}</h1>
          <p className="mx-auto mt-6 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">{copy.subtitle}</p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <section>
          <div className="mb-8 flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600"><ShieldCheck className="h-5 w-5" /></div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">{copy.practicesTitle}</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {copy.cards.map((card, index) => {
              const Icon = CARD_ICONS[index];
              return (
                <motion.article key={card.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-7">
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-blue-300"><Icon className="h-5 w-5" /></div>
                  <h3 className="text-lg font-semibold text-slate-950">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
                  <ul className="mt-5 space-y-3">
                    {card.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-sm leading-6 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" /><span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="mt-14 overflow-hidden rounded-3xl border border-blue-200/50 bg-slate-950 text-white shadow-xl shadow-slate-200/50">
          <div className="grid lg:grid-cols-[1.15fr_.85fr]">
            <div className="p-7 sm:p-10">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300"><Mail className="h-6 w-6" /></div>
              <h2 className="text-2xl font-bold">{copy.reportTitle}</h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">{copy.reportDescription}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a href="mailto:security@mybay.ai" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"><Mail className="h-4 w-4" />{copy.reportButton}</a>
                <a href="/.well-known/security.txt" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"><ExternalLink className="h-4 w-4" />{copy.securityTxt}</a>
              </div>
            </div>
            <div className="border-t border-slate-800 bg-slate-900/60 p-7 sm:p-10 lg:border-l lg:border-t-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-blue-200"><FileWarning className="h-4 w-4" />{copy.reportingGuideTitle}</h3>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">{copy.reportingGuide.map((point) => <li key={point}>• {point}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 rounded-2xl border border-amber-200/70 bg-amber-50/70 p-6 sm:grid-cols-[auto_1fr] sm:p-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{copy.boundariesTitle}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">{copy.boundaries.map((point) => <li key={point}>• {point}</li>)}</ul>
          </div>
        </section>

        <p className="mx-auto mt-10 max-w-4xl text-center text-xs leading-6 text-slate-400">{copy.note}</p>
      </main>
    </div>
  );
}
