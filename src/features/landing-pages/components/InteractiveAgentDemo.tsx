import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Globe2,
  MessageSquare,
  Radio,
  Sparkles
} from "lucide-react";

type DemoProvider = {
  id: string;
  name: string;
  short: string;
  accent: string;
};

type DemoChannel = {
  id: string;
  name: string;
  descZh: string;
  descEn: string;
  icon: typeof MessageSquare;
};

const providers: DemoProvider[] = [
  { id: "deepseek", name: "DeepSeek", short: "DS", accent: "from-cyan-400 to-blue-500" },
  { id: "openai", name: "OpenAI", short: "AI", accent: "from-emerald-400 to-teal-500" },
  { id: "claude", name: "Claude", short: "CL", accent: "from-orange-400 to-rose-500" },
  { id: "gemini", name: "Gemini", short: "GM", accent: "from-blue-400 to-violet-500" },
  { id: "qwen", name: "Qwen", short: "QW", accent: "from-purple-400 to-fuchsia-500" }
];

const channels: DemoChannel[] = [
  {
    id: "web",
    name: "Web Console",
    descZh: "内置对话工作台，创建后即可测试 Agent 能力",
    descEn: "Built-in chat workspace for immediate agent testing",
    icon: Globe2
  },
  {
    id: "feishu",
    name: "Feishu / Lark",
    descZh: "连接团队通讯渠道，自动接收消息与任务",
    descEn: "Connect team channels and receive tasks automatically",
    icon: MessageSquare
  },
  {
    id: "telegram",
    name: "Telegram Bot",
    descZh: "通过机器人面向用户或私域社群提供服务",
    descEn: "Serve users and communities through bot conversations",
    icon: Radio
  }
];

export function InteractiveAgentDemo() {
  const { t, i18n } = useTranslation("marketing");
  const isZh = i18n.language?.toLowerCase().startsWith("zh");
  const [selectedProvider, setSelectedProvider] = useState(providers[0]);
  const [selectedChannel, setSelectedChannel] = useState(channels[0]);
  const [isRunning, setIsRunning] = useState(true);

  const copy = useMemo(() => ({
    eyebrow: isZh ? "交互式产品演示" : "Interactive product demo",
    title: isZh
      ? "点击切换模型与渠道，感受真实控制台流程"
      : "Click through models and channels like a real control plane",
    desc: t("mainLanding.interactiveDemoDescription"),
    windowTitle: isZh ? "MyBay Agent 控制台" : "MyBay Agent Console",
    running: isZh ? "运行中" : "Running",
    paused: isZh ? "已暂停" : "Paused",
    deploy: isZh ? "一键部署" : "Deploy",
    chat: isZh ? "打开对话" : "Open Chat",
    test: isZh ? "检测链路" : "Check Route",
    stepsTitle: isZh ? "Agent 部署进程" : "Agent deployment flow",
    step1: isZh ? "配置模型与密钥" : "Configure model and key",
    step2: isZh ? "生成隔离实例" : "Create isolated instance",
    step3: isZh ? "注入安全访问链" : "Inject secure access chain",
    step4: isZh ? "对话工作台就绪" : "Chat workspace ready",
    previewTitle: isZh ? "实时运行摘要" : "Live runtime summary",
    previewDesc: isZh
      ? "实例保持独立隔离，平台只通过受保护的内部路由转发控制指令。"
      : "Each instance stays isolated; the platform only forwards control commands through protected internal routes.",
    model: isZh ? "模型引擎" : "Model Engine",
    channel: isZh ? "通讯渠道" : "Channel",
    providers: isZh ? "模型供应商" : "Model providers",
    channels: isZh ? "接入渠道" : "Connected channels",
    createInstance: isZh ? "创建实例" : "Provision",
    chatApi: isZh ? "对话 API" : "Chat API",
    secureAccess: isZh ? "安全访问" : "Secure"
  }), [isZh, t]);

  const stepItems = [copy.step1, copy.step2, copy.step3, copy.step4];

  return (
    <section className="relative overflow-hidden bg-slate-950 px-4 py-20">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/25 blur-3xl" />
      <div className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="absolute inset-0 bg-slate-950/20" />

      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.9fr_1.25fr] lg:gap-14">
        <div className="text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-semibold text-blue-200">
            <Sparkles className="h-3.5 w-3.5" />
            {copy.eyebrow}
          </div>
          <h2 className="mt-5 text-3xl font-black leading-tight tracking-tight text-white md:text-5xl">
            {copy.title}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-300 md:text-base lg:mx-0">
            {copy.desc}
          </p>
          <div className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-3 lg:mx-0">
            {[
              { label: "30s", text: copy.createInstance },
              { label: "8642", text: copy.chatApi },
              { label: "TLS", text: copy.secureAccess }
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 text-left">
                <div className="text-xl font-black text-white">{item.label}</div>
                <div className="mt-1 text-xs font-medium text-slate-400">{item.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-white/15 bg-slate-900/90 shadow-2xl shadow-blue-950/40">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-rose-500" />
              <span className="h-3 w-3 rounded-full bg-amber-400" />
              <span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <div className="text-xs font-semibold text-slate-400">{copy.windowTitle}</div>
            <button
              type="button"
              onClick={() => setIsRunning((value) => !value)}
              className={`h-8 rounded-full px-3 text-xs font-bold transition ${
                isRunning
                  ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30"
                  : "bg-white/10 text-slate-300 ring-1 ring-white/10"
              }`}
            >
              {isRunning ? copy.running : copy.paused}
            </button>
          </div>

          <div className="space-y-5 p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Bot className="h-4 w-4 text-blue-300" />
                  Content Ops Agent
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">agent-nova-2026.localhost</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/25">
                  {copy.deploy}
                </button>
                <button type="button" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/10">
                  {copy.chat}
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_0.9fr]">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{copy.providers}</div>
                  <div className="flex flex-wrap gap-2">
                    {providers.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelectedProvider(provider)}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 transition ${
                          selectedProvider.id === provider.id
                            ? "border-blue-400/60 bg-blue-500/15 text-white"
                            : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:bg-white/[0.08]"
                        }`}
                      >
                        <span className={`grid h-7 w-7 place-items-center rounded-xl bg-gradient-to-br ${provider.accent} text-[10px] font-black text-white`}>
                          {provider.short}
                        </span>
                        <span className="text-xs font-bold">{provider.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{copy.channels}</div>
                  <div className="space-y-2">
                    {channels.map((channel) => {
                      const Icon = channel.icon;
                      const active = selectedChannel.id === channel.id;
                      return (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => setSelectedChannel(channel)}
                          className={`w-full rounded-2xl border p-3 text-left transition ${
                            active
                              ? "border-emerald-400/50 bg-emerald-400/10"
                              : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-emerald-400/15 text-emerald-200" : "bg-white/5 text-slate-400"}`}>
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-white">{channel.name}</span>
                              <span className="mt-0.5 block text-xs leading-5 text-slate-400">
                                {isZh ? channel.descZh : channel.descEn}
                              </span>
                            </span>
                            {active ? <Check className="mt-1 h-4 w-4 text-emerald-300" /> : <ChevronRight className="mt-1 h-4 w-4 text-slate-600" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">{copy.stepsTitle}</div>
                  <button type="button" className="rounded-xl border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-blue-200">
                    {copy.test}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {stepItems.map((step, index) => {
                    const done = index < 3 || isRunning;
                    return (
                      <div key={step} className="flex items-center gap-3">
                        <div className={`grid h-8 w-8 place-items-center rounded-full border ${
                          done
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-white/10 bg-white/5 text-slate-500"
                        }`}>
                          {done ? <Check className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
                          <div className="text-xs font-semibold text-slate-200">{step}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="text-sm font-bold text-white">{copy.previewTitle}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{copy.previewDesc}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[
                      { label: selectedProvider.name, value: copy.model },
                      { label: selectedChannel.name, value: copy.channel },
                      { label: isRunning ? "99.9%" : "--", value: copy.running }
                    ].map((item) => (
                      <div key={item.value} className="rounded-xl bg-white/[0.06] px-3 py-2">
                        <div className="truncate text-xs font-black text-white">{item.label}</div>
                        <div className="mt-1 text-[10px] font-semibold text-slate-500">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
