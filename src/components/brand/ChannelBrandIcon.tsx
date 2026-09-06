import { Globe, MessageSquareMore, Send, Slack, Terminal, Wind } from "lucide-react";

interface ChannelBrandIconProps {
  channelId?: string | null;
  className?: string;
}

const CHANNEL_ASSETS: Record<string, string> = {
  telegram: "/assets/channels/telegram.png",
  feishu: "/assets/channels/feishu.png",
  lark: "/assets/channels/feishu.png",
  weixin: "/assets/channels/wechat.png",
  wechat: "/assets/channels/wechat.png",
};

export function ChannelBrandIcon({ channelId, className = "h-5 w-5" }: ChannelBrandIconProps) {
  const normalizedChannelId = String(channelId || "web").trim().toLowerCase();
  const asset = CHANNEL_ASSETS[normalizedChannelId];

  if (asset) {
    return (
      <img
        src={asset}
        alt=""
        width="256"
        height="256"
        aria-hidden="true"
        className={`shrink-0 object-contain ${className}`}
      />
    );
  }

  if (normalizedChannelId === "web") return <Globe className={`shrink-0 text-indigo-500 ${className}`} aria-hidden="true" />;
  if (normalizedChannelId === "slack") return <Slack className={`shrink-0 text-[#4a154b] dark:text-[#e01e5a] ${className}`} aria-hidden="true" />;
  if (normalizedChannelId === "webhook" || normalizedChannelId === "api") return <Terminal className={`shrink-0 text-content-secondary ${className}`} aria-hidden="true" />;
  if (normalizedChannelId === "feishu" || normalizedChannelId === "lark") return <Wind className={`shrink-0 text-[#3370ff] ${className}`} aria-hidden="true" />;
  if (normalizedChannelId === "telegram") return <Send className={`shrink-0 text-[#229ed9] ${className}`} aria-hidden="true" />;
  return <MessageSquareMore className={`shrink-0 text-content-secondary ${className}`} aria-hidden="true" />;
}
