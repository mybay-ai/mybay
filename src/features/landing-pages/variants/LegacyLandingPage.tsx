import { ArrowRight, Box, CheckCircle2, ChevronRight, Cpu, Layers, MessageSquare, ShieldCheck, Zap, X, Shield, Terminal, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui";
import { motion } from "motion/react";
import { PROVIDERS, CHANNELS } from "../../../constants/logos";

const features = [
  {
    title: "秒级生产力交付",
    desc: "规避复杂的 Linux 环境初始化，一键拉起具备独立域名与 SSL 的生产级 Agent 容器。",
    icon: <Zap className="w-6 h-6 text-blue-500" />
  },
  {
    title: "多供应商智能路由",
    desc: "中心化管理所有 AI 厂商凭据，支持不同任务间根据成本或性能自动路由模型能力。",
    icon: <Cpu className="w-6 h-6 text-indigo-500" />
  },
  {
    title: "全渠道全栈式接入",
    desc: "从飞书到 Telegram，从 API 到 Webhook，麦贝已帮你解决了所有通信层的握手兼容难题。",
    icon: <MessageSquare className="w-6 h-6 text-cyan-500" />
  },
  {
    title: "企业级数据沙箱",
    desc: "每个实例运行在完全隔离的 Docker 容器中，API 调用独立、持久化存储独立，确保数据不出域。",
    icon: <Layers className="w-6 h-6 text-purple-500" />
  },
  {
    title: "自愈式容器集群",
    desc: "内置精细化健康扫描，一旦探测到 Agent 逻辑异常或端口阻塞，网关将自动执行冷热重启。",
    icon: <CheckCircle2 className="w-6 h-6 text-green-500" />
  },
  {
    title: "可回溯审计日志",
    desc: "不仅有运行日志，麦贝还记录了每一次部署变更、密钥更新的操作流水，满足高合规性要求。",
    icon: <Box className="w-6 h-6 text-slate-500" />
  }
];

const BrandLogo = ({ item }: { item: any }) => {
  if (item.logo) {
    return (
      <div className="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110">
        <img 
          src={item.logo} 
          alt={item.name} 
          className="w-full h-full object-contain filter drop-shadow-sm" 
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }
  if (item.fallback) {
    const FallbackIcon = item.fallback;
    return (
      <div className="w-9 h-9 md:w-10 md:h-10 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110">
        <FallbackIcon className="w-5 h-5 md:w-6 md:h-6 text-slate-600" />
      </div>
    );
  }
  return (
    <div className="w-9 h-9 md:w-10 md:h-10 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300 group-hover:scale-110">
      <Settings className="w-5 h-5 md:w-6 md:h-6 text-slate-400" />
    </div>
  );
};

const channelHoverConfig: Record<string, { borderColor: string; bgColor: string; glowColor: string }> = {
  "飞书": {
    borderColor: "hover:border-teal-400/80 focus-within:border-teal-400",
    bgColor: "group-hover:bg-teal-50/50",
    glowColor: "hover:shadow-teal-100/40"
  },
  "Telegram": {
    borderColor: "hover:border-sky-400/80 focus-within:border-sky-400",
    bgColor: "group-hover:bg-sky-50/50",
    glowColor: "hover:shadow-sky-100/40"
  },
  "Discord": {
    borderColor: "hover:border-indigo-400/80 focus-within:border-indigo-400",
    bgColor: "group-hover:bg-indigo-50/50",
    glowColor: "hover:shadow-indigo-100/40"
  },
  "WhatsApp": {
    borderColor: "hover:border-emerald-400/80 focus-within:border-emerald-400",
    bgColor: "group-hover:bg-emerald-50/50",
    glowColor: "hover:shadow-emerald-100/40"
  },
  "钉钉": {
    borderColor: "hover:border-blue-400/80 focus-within:border-blue-400",
    bgColor: "group-hover:bg-blue-50/50",
    glowColor: "hover:shadow-blue-100/40"
  },
  "QQ": {
    borderColor: "hover:border-sky-400/80 focus-within:border-sky-400",
    bgColor: "group-hover:bg-sky-50/50",
    glowColor: "hover:shadow-sky-100/40"
  }
};

export function LegacyLandingPage({ currentUser }: { currentUser?: any }) {
  const ctaLink = currentUser ? "/app" : "/register";
  const ctaText = currentUser ? "进入控制台" : "立即创建第一个 Agent";
  return (
    <div className="overflow-hidden">
      {/* Hero Section */}
      <section className="relative pt-24 pb-12 md:pt-32 md:pb-20 lg:pt-36 lg:pb-24 px-4 overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-[600px] bg-gradient-to-b from-blue-50/80 to-transparent -z-10" />

        <div className="max-w-7xl mx-auto flex flex-col items-center text-center space-y-8 md:space-y-10 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 bg-white border border-slate-200 rounded-full text-blue-600 text-xs md:text-sm font-medium shadow-sm hover:border-blue-300 transition-colors"
          >
            <span>当前版本v1.2.2 (2026.6.4)</span>
            <ChevronRight className="w-3 h-3 md:w-4 md:h-4" />
          </motion.div>

            <motion.h1 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-slate-950 leading-[1.1] md:leading-[1.05]"
            >
              <span className="block mb-2 md:mb-4">仅需 <span className="text-blue-600">30 秒</span></span>
              <span className="block">即可拥有您专属的 24/7 AI Agent</span>
            </motion.h1>

            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="max-w-3xl text-base sm:text-lg md:text-xl text-slate-600 leading-relaxed px-4"
            >
              麦贝开源版是面向 AI Agent 的本地优先自托管控制面。通过 Docker 容器隔离与本地加密凭据管理，管理员可以在自己的机器上完成部署、配置、监控和多渠道接入。
            </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full sm:w-auto px-4 sm:px-0"
          >
            <Link to={ctaLink} className="w-full sm:w-auto">
              <Button size="xl" className="w-full sm:w-auto shadow-md group rounded-full">
                {ctaText}
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <a href="#deployment-steps" className="w-full sm:w-auto">
              <Button size="xl" variant="outline" className="w-full sm:w-auto rounded-full">
                查看部署流程
              </Button>
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="flex flex-wrap justify-center gap-2 md:gap-3 px-4"
          >
            {[
              "独立实例隔离", "自动反向代理", "Basic Auth 安全访问", "24/7全时段在线", "多模型接入"
            ].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-100 rounded-full text-slate-500 text-[10px] md:text-xs font-medium shadow-sm">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                {tag}
              </span>
            ))}
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="w-full max-w-5xl mt-12 md:mt-16 p-2 md:p-3 bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-slate-200/60 relative group"
          >
            <div className="w-full bg-slate-950 rounded-xl md:rounded-[1.75rem] overflow-hidden border border-white/5 flex flex-col aspect-auto">
              {/* Fake Browser Title Bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400/80 shadow-sm" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80 shadow-sm" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 shadow-sm" />
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-950 rounded-md border border-white/5 mx-auto">
                  <Shield className="w-3 h-3 text-emerald-400" />
                  <span className="text-[10px] font-mono text-slate-400">agent-alpha.xxx.com</span>
                </div>
                <div className="w-12" />
              </div>

              {/* Console Body */}
              <div className="flex-1 p-4 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 overflow-hidden">
                {/* Left Panel: Status Cards */}
                <div className="md:col-span-5 space-y-4">
                  <div className="bg-slate-900/50 p-4 md:p-6 rounded-2xl border border-white/5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                          <Cpu className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">实例状态</p>
                          <p className="text-sm font-bold text-white">生产节点 A</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-emerald-400 uppercase">运行中</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 py-2">
                       <div className="flex items-center justify-between px-3 py-2 bg-slate-950/50 rounded-lg text-xs">
                          <span className="text-slate-500">大模型供应商</span>
                          <span className="text-slate-300 font-mono">DeepSeek / OpenAI</span>
                       </div>
                       <div className="flex items-center justify-between px-3 py-2 bg-slate-950/50 rounded-lg text-xs">
                          <span className="text-slate-500">验证</span>
                          <span className="text-emerald-400 font-mono flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Basic Auth Active
                          </span>
                       </div>
                       <div className="flex items-center justify-between px-3 py-2 bg-slate-950/50 rounded-lg text-xs">
                          <span className="text-slate-500">健康检查</span>
                          <span className="text-blue-400 font-medium">Passed (32ms)</span>
                       </div>
                    </div>
                  </div>
                </div>

                {/* Right Panel: Logs Terminal */}
                <div className="md:col-span-7 flex flex-col bg-slate-950 border border-white/5 rounded-2xl overflow-hidden relative group/term h-60 md:h-80">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/50 border-b border-white/5">
                    <Terminal className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Instance Logs Streaming</span>
                  </div>
                  <div className="flex-1 p-4 font-mono text-[10px] space-y-2.5 text-slate-400 overflow-hidden relative">
                    <div className="flex gap-3">
                      <span className="text-blue-500/80 shrink-0">11:47:32</span>
                      <span className="text-slate-200">[INF] Docker container mybay-agent-v1 started successfully.</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-blue-500/80 shrink-0">11:47:33</span>
                      <span className="text-slate-200">[INF] Setting up internal reverse proxy on port 9119...</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-blue-500/80 shrink-0">11:47:35</span>
                      <span className="text-emerald-400">[SUC] Health Check passed: All systems operational.</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-blue-500/80 shrink-0">11:47:37</span>
                      <span className="text-slate-400">[ACM] Incoming request from TG-Webhook (Authenticated: true)</span>
                    </div>
                    <div className="flex gap-3">
                      <span className="text-blue-500/80 shrink-0">11:47:38</span>
                      <span className="text-blue-400">[LLM] Routing prompt to DeepSeek-V3 (Token Check OK)</span>
                    </div>
                    <div className="flex gap-3 animate-pulse">
                      <span className="text-blue-500/80 shrink-0">11:47:40</span>
                      <span className="text-slate-500">[LOG] Streaming response chunks (210 tokens/sec)...</span>
                    </div>
                    
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-950 to-transparent" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Glossy overlay effect */}
            <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
          </motion.div>
        </div>
      </section>

      {/* Credibility / Partners Row */}
      <section className="py-12 border-y border-slate-100 bg-slate-50/30">
        <div className="max-w-7xl mx-auto px-4">
          <p className="text-center text-[11px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-8">
            信任驱动 · 完美兼容主流生态
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-40 grayscale hover:grayscale-0 transition-all duration-700">
            {PROVIDERS.slice(0, 6).map(p => (
              <div key={p.name} className="flex items-center gap-2">
                <BrandLogo item={p} />
                <span className="text-sm font-bold text-slate-900 hidden sm:inline">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Efficiency Comparison Section */}
      <section className="py-16 md:py-24 bg-slate-950 text-white px-4 overflow-hidden relative">
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl md:text-4xl font-bold mb-4">为什么选择麦贝?</h2>
            <p className="text-slate-400">将传统长达数小时的部署工作，压缩至极致的秒数。</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
            <div className="p-8 rounded-[2rem] bg-slate-900 border border-slate-800 relative group overflow-hidden">
              <div className="absolute top-4 right-4 text-slate-700 font-mono text-[80px] leading-none select-none opacity-20">OLD</div>
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                传统本地/手动部署方式
              </h3>
              <ul className="space-y-4 relative z-10">
                {[
                  "安装不同版本的 Python/Node 环境 (15min)",
                  "处理 pip/npm 依赖冲突与版本不一致 (20min)",
                  "手动配置并维护繁琐的 .env 环境变量 (10min)",
                  "折腾 ngrok/frp 等内网穿透以实现外部 Webhook (15min)",
                  "手动管理启动进程，终端关闭即丢失 (5min)",
                  "跨设备协同困难，代码与配置无法同步 (∞)"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-slate-500 text-sm italic">
                    <X className="w-4 h-4 text-red-500/50" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8 pt-6 border-t border-slate-800 text-slate-500 text-sm">
                预计总耗时：<span className="text-red-400 font-bold">1.5 小时 + 不稳定的本地环境</span>
              </div>
            </div>

            <div className="p-8 rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-700 border border-blue-500 relative group overflow-hidden shadow-2xl shadow-blue-500/20">
              <div className="absolute top-4 right-4 text-white/10 font-mono text-[80px] leading-none select-none">NEW</div>
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                麦贝极速部署
              </h3>
              <ul className="space-y-4 relative z-10">
                {[
                  "无需本地搭建环境，全视觉化配置 Agent",
                  "自带独立公网二级域名，完美对接 Webhook",
                  "依赖项由本机 Docker 容器隔离处理，减少冲突",
                  "多模型 Key 在本地加密存储，按实例配置使用",
                  "内建进程守护与自愈，24/7 持久运行",
                  "即刻获取可分享、可协作的生产级链接"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-blue-100 text-sm font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8 pt-6 border-t border-white/10 text-white/70 text-sm">
                预计总耗时：<span className="text-white font-bold text-lg">约 30 秒</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 Steps Deployment */}
      <section id="deployment-steps" className="py-16 md:py-20 lg:py-24 bg-white px-4">
        <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-950 text-center mb-12 md:mb-16">四步，完成 Agent 控制台交付</h2>
            
            {/* Desktop & Tablet: Grid layout */}
            <div className="hidden md:grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              {[
                { title: "接入项目", desc: "快速导入部署资源，自动识别运行环境与核心依赖，为 Agent 控制台完成基础准备。"},
                { title: "环境配置", desc: "统一管理模型密钥、运行参数、数据库与持久化路径，让部署配置更清晰、更安全。"},
                { title: "托管运行", desc: "在本机拉起控制台服务，完成容器编排、端口映射与后台运行，减少重复操作。"},
                { title: "可视化管理", desc: "通过可视化控制台创建和管理 Agent 实例，查看运行状态、访问地址、日志与部署结果。"}
              ].map((step, i) => (
                <div key={i} className="relative p-6 lg:p-8 bg-slate-50 rounded-2xl lg:rounded-3xl border border-slate-100 hover:border-blue-100 transition-all">
                  <div className="w-10 h-10 lg:w-12 lg:h-12 bg-white text-blue-600 rounded-xl lg:rounded-2xl flex items-center justify-center font-black text-lg lg:text-xl mb-6 shadow-sm border border-slate-100">{i+1}</div>
                  <h3 className="font-bold text-slate-950 mb-2">{step.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>

            {/* Mobile: Timeline layout */}
            <div className="md:hidden flex flex-col space-y-6 relative pl-4">
              <div className="absolute left-[35px] top-6 bottom-6 w-0.5 bg-blue-100/50" />
              {[
                { title: "源码获取", desc: "git clone 并在本地安装 npm 基础依赖环境"},
                { title: "配置注入", desc: "根据 .env.example 声明平台运行所需的关键变量"},
                { title: "服务拉起", desc: "通过容器化引擎一键初始化控制面板与数据库"},
                { title: "本地管理", desc: "访问 Web UI 端口，即刻交付具备生产能力的 Agent"}
              ].map((step, i) => (
                <div key={i} className="relative flex gap-4 bg-slate-50 border border-slate-100 p-5 rounded-2xl">
                  <div className="w-10 h-10 shrink-0 bg-white border border-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-black text-lg shadow-sm relative z-10">{i+1}</div>
                  <div>
                    <h3 className="font-bold text-slate-900 mb-1">{step.title}</h3>
                    <p className="text-slate-500 text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-16 md:py-20 lg:py-24 bg-slate-50 px-4">
        <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900 text-center mb-12 md:mb-16">适合多种业务场景</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
              {[
                { title: "个人开发者", desc: "快速把本地 Agent Demo 部署成在线稳定服务。" }, 
                { title: "AI 工作室", desc: "为不同客户交付独立 Agent 实例，隔离数据环境。" }, 
                { title: "企业内部团队", desc: "统一集中管理和监控多个业务域的专属 Agent。" }, 
                { title: "自动化服务商", desc: "标准化部署、维护和规模化交付各类 AI 能力。" }
              ].map(useCase => (
                <div key={useCase.title} className="p-6 md:p-8 bg-white rounded-2xl border border-slate-100 shadow-sm transition-all hover:shadow-md hover:border-blue-100">
                  <h3 className="font-bold text-slate-900 mb-3 text-lg">{useCase.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{useCase.desc}</p>
                </div>
              ))}
            </div>
        </div>
      </section>

      {/* Pain Points Section */}
      <section className="py-16 md:py-20 lg:py-24 bg-slate-900 text-white overflow-hidden relative">
        <div className="hidden lg:block absolute top-0 right-0 w-[50%] h-full bg-blue-500/10 skew-x-12 translate-x-20 z-0" />
        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 md:gap-16 items-center">
            <div className="space-y-6 md:space-y-8">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight">
                打破部署瓶颈，<br className="hidden md:block"/>让 AI Agent <span className="text-blue-400">敏捷交付</span>
              </h2>
              <p className="text-slate-400 text-sm md:text-base leading-relaxed max-w-xl">
                大多数 AI 项目止步于实验原型，正是因为在复杂的生产环境、全渠道适配和运维监控中耗费了开发者 80% 的精力。
              </p>
              <div className="space-y-4 md:space-y-6">
                {[
                  { label: "密钥预存管理", desc: "告别凌乱的环境变量，实现 AI 模型 Key 的中心化安全管控。" },
                  { label: "全渠道统一接入", desc: "内置标准化接口适配，一次部署即可打通飞书、钉钉、Telegram 等渠道。" },
                  { label: "极致高可用保障", desc: "内建秒级健康自检与进程监控，确保您的 Agent 7x24 小时在线。" },
                  { label: "企业级访问安全", desc: "一键配置反向代理与 Basic Auth 鉴权，精准掌控每一次 API 调用。" }
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                    <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 className="w-4 h-4 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm md:text-base">{item.label}</h4>
                      <p className="text-slate-400 text-xs md:text-sm mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Visual Abstract for Pain point solution */}
            <div className="bg-slate-800/80 p-5 md:p-8 rounded-2xl md:rounded-3xl border border-slate-700 shadow-2xl backdrop-blur-md max-w-lg mx-auto w-full relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur opacity-50 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative bg-slate-800 rounded-xl overflow-hidden shadow-inner">
                <div className="flex items-center gap-2 mb-4 md:mb-6 border-b border-slate-700 pb-3 md:pb-4 px-4 pt-4">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 ml-2 uppercase tracking-widest flex items-center gap-1.5">
                    <Box className="w-3 h-3" />
                    Deployment Self-Healing
                  </span>
                </div>
                <div className="space-y-3 md:space-y-4 p-4 pt-0">
                  <div className="flex items-center justify-between p-3 md:p-4 bg-blue-500/10 rounded-xl font-mono text-[10px] md:text-xs">
                    <div className="flex items-center gap-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                       <span className="text-blue-300">Syncing config.yaml...</span>
                    </div>
                    <span className="text-slate-500">v1.2.4</span>
                  </div>
                  <div className="flex items-center justify-between p-3 md:p-4 bg-emerald-500/10 rounded-xl font-mono text-[10px] md:text-xs text-emerald-400 border border-emerald-500/10">
                    <div className="flex items-center gap-2">
                       <CheckCircle2 className="w-3.5 h-3.5" />
                       <span>Instance "MyBay-Agent" online</span>
                    </div>
                    <span>99.9% Up</span>
                  </div>
                  <div className="flex items-center justify-between p-3 md:p-4 bg-amber-500/10 rounded-xl font-mono text-[10px] md:text-xs text-amber-400 border border-amber-500/10">
                    <div className="flex items-center gap-2">
                       <Zap className="w-3.5 h-3.5 animate-bounce" />
                       <span>Auto-Healing: Restarting Webhook</span>
                    </div>
                    <span className="italic">Proactive...</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-16 md:py-20 lg:py-24 bg-white px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-16 space-y-4">
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight text-slate-900">从创建到交付，所需能力一次配齐</h2>
            <p className="text-sm md:text-base text-slate-500 max-w-2xl mx-auto">不仅管理容器启动，还覆盖 Agent 的本地部署生命周期。</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {features.map((f, i) => (
              <div 
                key={i}
                className="p-6 md:p-8 bg-slate-50 border border-slate-100 rounded-2xl md:rounded-3xl transition-all md:hover:-translate-y-1 lg:hover:bg-white lg:hover:shadow-xl lg:hover:shadow-slate-100/50"
              >
                <div className="w-10 h-10 md:w-12 md:h-12 bg-white rounded-xl md:rounded-2xl flex items-center justify-center shadow-sm mb-5 md:mb-6">
                  {f.icon}
                </div>
                <h3 className="text-base md:text-lg font-bold text-slate-900 mb-2 md:mb-3">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Providers & Channels */}
      <section id="providers" className="py-16 md:py-20 lg:py-24 bg-slate-50 px-4">
        <div className="max-w-7xl mx-auto space-y-16 md:space-y-24">
          <div className="text-center">
            <h3 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">兼容主流 AI 模型厂商</h3>
            <p className="text-sm md:text-base text-slate-500 mb-8 md:mb-12">无缝接入全球顶级模型服务与开源权重，统一接口随心切换。</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-6 justify-center">
              {PROVIDERS.map(p => (
                <div key={p.name} className="flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 bg-white border border-slate-200 rounded-xl md:rounded-2xl shadow-sm hover:border-blue-300 transition-colors group">
                  <BrandLogo item={p} />
                  <span className="text-xs md:text-sm font-bold text-slate-700 truncate">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div id="channels" className="text-center max-w-5xl mx-auto">
            <h3 className="text-2xl md:text-3xl font-bold text-slate-900 mb-4">连接每一位业务终端用户</h3>
            <p className="text-sm md:text-base text-slate-500 mb-8 md:mb-12 px-4 max-w-2xl mx-auto">为不同受众选择合适的聊天软件作为 Agent 入口，一次配置，直接接管消息收发。</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6">
              {CHANNELS.map((c, i) => {
                const config = channelHoverConfig[c.name] || {
                  borderColor: "hover:border-blue-400 focus-within:border-blue-400",
                  bgColor: "group-hover:bg-blue-50/50",
                  glowColor: "hover:shadow-blue-100/40"
                };
                return (
                  <motion.div
                    key={i}
                    whileHover={{ y: -6, scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    style={{ originX: 0.5, originY: 0.5 }}
                    className={`flex flex-col items-center justify-center p-5 md:p-6 bg-white border border-slate-150 rounded-[1.5rem] shadow-sm hover:shadow-md transition-all duration-300 group cursor-pointer ${config.borderColor} ${config.bgColor} ${config.glowColor}`}
                  >
                    <div className="w-16 h-16 flex items-center justify-center bg-slate-50 border border-slate-100 rounded-2xl group-hover:bg-white group-hover:shadow-sm group-hover:scale-105 transition-all duration-300 mb-3">
                      <BrandLogo item={c} />
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-slate-700 group-hover:text-slate-900 transition-colors">
                      {c.name}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Platform Capabilities */}
      <section id="capabilities" className="py-16 md:py-20 lg:py-24 bg-white px-4">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-10 md:mb-12">让 Agent 部署不再是一场折腾</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 text-left">
            {[
              { title: "一键创建专属 Agent 实例", desc: "从模型配置、访问域名到容器启动，平台自动完成部署流程。无需手动登录服务器，也不用重复编写部署脚本。" },
              { title: "独立访问与权限保护", desc: "每个实例拥有独立访问地址与登录保护，用户之间互不干扰。适合团队、客户演示、私有项目和多 Agent 场景。" },
              { title: "统一管理所有运行实例", desc: "集中查看实例状态、访问入口、运行日志与部署结果。无论是一个 Agent，还是几十个 Agent，都能清晰掌控。" },
              { title: "面向生产环境的稳定架构", desc: "为每个 Agent 提供独立、安全、可控的运行环境。从部署、访问到运行监控，全流程自动化处理，让 Agent 真正稳定上线。" }
            ].map(c => (
              <div key={c.title} className="p-6 md:p-8 border border-slate-100 rounded-2xl md:rounded-3xl bg-slate-50 hover:border-blue-200 transition-colors">
                <h3 className="text-lg md:text-xl font-bold text-slate-900 mb-2 md:mb-3">{c.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security & Infrastructure Section - Redesigned */}
      <section className="py-24 bg-white px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="max-w-3xl mb-16">
            <h2 className="text-3xl md:text-5xl font-black text-slate-950 tracking-tighter leading-tight mb-6">
              清晰的安全边界，<br />保护您的<span className="text-blue-600">本地配置</span>
            </h2>
            <p className="text-slate-500 text-lg leading-relaxed font-medium">
              麦贝开源版提供本地管理员认证、凭证加密存储、实例路径校验和容器资源限制。Docker Socket 仍具有高权限，部署者必须限制控制面访问并妥善保护宿主机。
            </p>
          </div>

          {/* Bento Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Main Feature - Large Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="md:col-span-2 row-span-2 p-8 md:p-12 bg-slate-950 rounded-[2.5rem] relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-br from-blue-600/20 to-transparent pointer-events-none" />
              <div className="relative z-10 h-full flex flex-col justify-between">
                <div>
                  <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-8 shadow-lg shadow-blue-500/20">
                    <Layers className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">Traefik 公网路由</h3>
                  <p className="text-slate-400 text-base md:text-lg leading-relaxed max-w-lg">
                    Server 模式使用 Traefik 提供域名路由和 HTTPS 终止，并通过动态配置连接受管 Agent 服务。实际可用性仍取决于主机、网络和运维配置。
                  </p>
                </div>
                <div className="mt-12 flex flex-wrap gap-3">
                  {["动态路由", "HTTPS 终止", "配置生成", "健康检查"].map(tag => (
                    <span key={tag} className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-bold text-blue-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {/* Visual Abstract Decoration */}
              <div className="absolute -bottom-10 -right-10 w-64 h-64 bg-blue-500/10 blur-[80px] rounded-full" />
            </motion.div>

            {/* Small Card 1 */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="p-8 bg-slate-50 border border-slate-100 rounded-[2.5rem] hover:bg-white hover:shadow-xl transition-all group"
            >
              <div className="w-12 h-12 bg-white border border-slate-100 rounded-xl flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                <Box className="w-6 h-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Docker 容器边界</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                每个 Agent 使用独立容器、网络和数据路径运行，以减少实例之间的资源和文件冲突；这不等同于硬件级安全隔离。
              </p>
            </motion.div>

            {/* Small Card 2 */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="p-8 bg-slate-50 border border-slate-100 rounded-[2.5rem] hover:bg-white hover:shadow-xl transition-all group"
            >
              <div className="w-12 h-12 bg-white border border-slate-100 rounded-xl flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                <ShieldCheck className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">访问凭证管理</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                为受管实例生成和保存访问凭证，并在支持的运行路径中应用认证配置；管理员仍需限制公网访问。
              </p>
            </motion.div>

            {/* Wide Card 3 */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="md:col-span-3 p-8 md:p-10 bg-slate-50 border border-slate-100 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-8 group"
            >
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  凭证存储与操作记录
                </h3>
                <p className="text-slate-500 text-sm max-w-xl">
                  模型凭证使用应用层加密后保存，控制面记录相关管理操作。具体合规要求仍需部署者根据自身环境评估。
                </p>
              </div>
              <div className="flex -space-x-4">
                 {[1,2,3,4].map(i => (
                   <div key={i} className="w-12 h-12 rounded-full border-4 border-white bg-slate-200 flex items-center justify-center shrink-0">
                      <div className="w-5 h-5 bg-slate-400 rounded-sm opacity-20" />
                   </div>
                 ))}
                 <div className="w-12 h-12 rounded-full border-4 border-white bg-blue-600 flex items-center justify-center text-white text-[10px] font-black shrink-0 relative overflow-hidden">
                    SECURE
                 </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 bg-slate-50 px-4 border-t border-slate-100">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-slate-900">常见问题</h2>
            <p className="text-slate-500 mt-2">关于麦贝平台，您可能想了解的更多细节</p>
          </div>
          <div className="space-y-4">
            {[
              {
                q: "麦贝是如何保证我的 API Key 安全的？",
                a: "API Key 在存储前由后端加密，保存后不会通过凭证接口返回明文。部署实例时，后端按配置将所需凭证传入受管容器；管理员应同时保护主机、数据库和加密密钥。"
              },
              {
                q: "多模型 API Key 如何安全保存？",
                a: "这意味着您可以在麦贝平台集中管理来自 OpenAI、Anthropic、DeepSeek 等不同厂商的密钥。部署新实例时，只需勾选已有的凭据，无需重复输入。实现一次配置，全局复用。"
              },
              {
                q: "数据存储在哪里？",
                a: "麦贝支持灵活的存储模式。默认情况下，所有对话记录与 Agent 状态均存储在每个实例独立的 Docker Volume 中。您可以选择将数据挂载到外部持久化存储，确保即使容器销毁，数据依然完好。"
              },
              {
                q: "如何将 Agent 接入我现有的业务系统？",
                a: "每个麦贝实例都提供独立的 Webhook 地址与 API 鉴权。您只需在飞书、钉钉或其他业务系统配置对应的推送地址，即可完成双向通信。"
              }
            ].map((faq, i) => (
              <div key={i} className="p-6 bg-white border border-slate-100 rounded-2xl shadow-sm">
                <h4 className="font-bold text-slate-900 mb-2 flex items-start gap-3">
                   <span className="text-blue-500 font-mono">Q.</span>
                   {faq.q}
                </h4>
                <p className="text-slate-600 text-sm leading-relaxed pl-7">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 md:py-24 text-center px-4 bg-slate-50">
        <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-6 md:mb-8">准备部署您的企业级 Agent 实例？</h2>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
          <Link to={ctaLink} className="w-full sm:w-auto">
            <Button size="xl" className="w-full sm:w-auto rounded-full shadow-md">
              {currentUser ? "进入控制台" : "立即创建 Agent"}
            </Button>
          </Link>
        </div>
        <p className="text-xs md:text-sm text-slate-500">一次接入，即可跨越沟通终端边界</p>
      </section>
    </div>
  );
}
