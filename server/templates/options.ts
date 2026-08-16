import { TemplateOption } from "./types";

export const NOTIFY_CHANNELS: TemplateOption[] = [
  { label: "网页端", value: "web" },
  { label: "飞书", value: "feishu" },
  { label: "Webhook 端", value: "webhook" },
  { label: "Telegram", value: "telegram" },
  { label: "邮件", value: "email" }
];

export const DAILY_RUN_TIMES: TemplateOption[] = [
  { label: "早上 8:00", value: "08:00" },
  { label: "早上 9:00", value: "09:00" },
  { label: "上午 10:00", value: "10:00" },
  { label: "中午 12:00", value: "12:00" },
  { label: "下午 18:00", value: "18:00" },
  { label: "晚上 21:00", value: "21:00" }
];

export const CHECK_FREQUENCIES: TemplateOption[] = [
  { label: "每小时", value: "hourly" },
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" }
];

export const SUMMARY_PERIODS: TemplateOption[] = [
  { label: "每天", value: "daily" },
  { label: "每周", value: "weekly" }
];

export const OUTPUT_STYLES: TemplateOption[] = [
  { label: "极简要点", value: "bullet_points" },
  { label: "深度复盘", value: "detailed" },
  { label: "叙事体", value: "narrative" }
];

export const OUTPUT_LANGUAGES: TemplateOption[] = [
  { label: "中文 (简体)", value: "zh_CN" },
  { label: "英文", value: "en_US" }
];

export const REPLY_TONES: TemplateOption[] = [
  { label: "专业得体", value: "professional" },
  { label: "亲切暖心", value: "warm" },
  { label: "热情洋溢", value: "enthusiast" }
];

export const CONTENT_STYLES: TemplateOption[] = [
  { label: "情感共鸣", value: "emotional" },
  { label: "硬核干货", value: "technical" },
  { label: "生活分享", value: "lifestyle" }
];

export const VIDEO_PLATFORMS: TemplateOption[] = [
  { label: "抖音", value: "douyin" },
  { label: "TikTok", value: "tiktok" },
  { label: "快手", value: "kuaishou" }
];
