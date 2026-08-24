import { useState, useEffect } from "react";
import { X, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, Label } from "./ui";
import { useFeedback } from "./FeedbackProvider";
import type { AgentInstance, Credential } from "../types";
import { providerRegistry } from "@/shared/providerRegistry";
import { resolveProviderRegistryKey } from "@/shared/providerRegistryUtils";
import { AppSettingsLLMSection } from "./AppSettingsLLMSection";
import { AppSettingsChannelSection } from "./AppSettingsChannelSection";
import { AppSettingsSkillsSection } from "./AppSettingsSkillsSection";
import { useInstanceQuota } from "../hooks/useInstanceQuota";
import { isDeployChannelAllowedByEntitlement } from "@/shared/planChannelAccess";
import { skillPolicyRegistry } from "@/shared/skillPolicyRegistry";

import { api } from "../lib/api";

export function InstanceSettingsModal({ instance: initialInstance, onClose, onSave, currentUser, advancedResourceConfigEnabled = false }: { instance: AgentInstance, onClose: () => void, onSave: () => void, currentUser: any, advancedResourceConfigEnabled?: boolean }) {
  const { t } = useTranslation("dashboard");
  const { showToast, showAlert, showConfirm } = useFeedback();
  const [instance, setInstance] = useState<AgentInstance>(initialInstance);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);

  const quota = useInstanceQuota(currentUser);
  const externalChannelsAllowed = quota.externalChannelsAllowed;

  useEffect(() => {
    const fetchCreds = async () => {
      try {
        const data = await api.get("/api/credentials");
        if (data) {
          setCredentials(data);
        }
      } catch (err) {
        console.error("Failed to fetch credentials:", err);
      }
    };
    fetchCreds();

    const fetchDetail = async () => {
      try {
        const data = await api.get(`/api/instances/${initialInstance.id}`);
        if (data) {
          setInstance(data);
        }
      } catch (err) {
        console.error("Failed to fetch instance detail:", err);
      } finally {
        setLoadingDetail(false);
      }
    };
    fetchDetail();
  }, [initialInstance.id]);

  const [password, setPassword] = useState("");
  const defaultGeminiModel = providerRegistry.gemini?.defaultModel || "gemini-3.5-flash";
  const initialModel = instance.config?.model || instance.configSummary?.model || defaultGeminiModel;
  const rawProvider = instance.config?.provider || instance.configSummary?.provider || "gemini";
  const rawBaseUrl = instance.config?.baseUrl || instance.configSummary?.baseUrl || "";
  const initialProvider = resolveProviderRegistryKey(rawProvider, initialModel, rawBaseUrl);
  const initialBaseUrl = rawBaseUrl || providerRegistry[initialProvider]?.defaultBaseUrl || "";
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [isCustomModel, setIsCustomModel] = useState(() => {
    const conf = providerRegistry[initialProvider];
    const models = conf ? conf.models || [] : [];
    return models.length === 0 || !models.includes(initialModel);
  });
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerCredentialId, setProviderCredentialId] = useState(instance.config?.providerCredentialId || instance.configSummary?.providerCredentialId || "");
  const [channel, setChannel] = useState(instance.config?.channel || instance.configSummary?.channel || "");
  const [agentPrompt, setAgentPrompt] = useState(instance.config?.agentPrompt || instance.configSummary?.agentPrompt || "");
  const [enableDashboard, setEnableDashboard] = useState(instance.config?.enableDashboard ?? instance.configSummary?.enableDashboard ?? true);
  const [limitsCpu, setLimitsCpu] = useState(instance.config?.limitsCpu || instance.configSummary?.limitsCpu || "0.5");
  const [limitsMem, setLimitsMem] = useState(instance.config?.limitsMem || instance.configSummary?.limitsMem || "512MB");

  // Update states when instance detail is loaded
  useEffect(() => {
    if (!loadingDetail) {
      const rawProvider = instance.config?.provider || instance.configSummary?.provider || "gemini";
      const defaultGeminiModel = providerRegistry.gemini?.defaultModel || "gemini-3.5-flash";
      const m = instance.config?.model || instance.configSummary?.model || defaultGeminiModel;
      const rawBaseUrl = instance.config?.baseUrl || instance.configSummary?.baseUrl || "";
      const p = resolveProviderRegistryKey(rawProvider, m, rawBaseUrl);
      const resolvedBaseUrl = rawBaseUrl || providerRegistry[p]?.defaultBaseUrl || "";
      setProvider(p);
      setModel(m);
      setBaseUrl(resolvedBaseUrl);
      setProviderCredentialId(instance.config?.providerCredentialId || instance.configSummary?.providerCredentialId || "");
      setChannel(instance.config?.channel || instance.configSummary?.channel || "");
      setAgentPrompt(instance.config?.agentPrompt || instance.configSummary?.agentPrompt || "");
      setEnableDashboard(instance.config?.enableDashboard ?? instance.configSummary?.enableDashboard ?? true);
      setLimitsCpu(instance.config?.limitsCpu || instance.configSummary?.limitsCpu || "0.5");
      setLimitsMem(instance.config?.limitsMem || instance.configSummary?.limitsMem || "512MB");

      const conf = providerRegistry[p];
      const models = conf ? conf.models || [] : [];
      setIsCustomModel(models.length === 0 || !models.includes(m));

      // Update other channel states
      setTelegramAllowedUsers(instance.configSummary?.telegramAllowedUsers || instance.config?.telegramAllowedUsers || "");
      setDiscordAllowedGuilds(instance.configSummary?.discordAllowedGuilds || instance.config?.discordAllowedGuilds || "");
      setFeishuAppId(instance.configSummary?.feishuAppId || instance.config?.feishuAppId || "");
      setFeishuRegion(instance.configSummary?.feishuRegion || instance.config?.feishuRegion || "feishu");
      setQqBotAppId(instance.configSummary?.qqBotAppId || instance.config?.qqBotAppId || "");
      setQqBotAllowedUsers(instance.configSummary?.qqBotAllowedUsers || instance.config?.qqBotAllowedUsers || "");
      setQqBotAllowedGuilds(instance.configSummary?.qqBotAllowedGuilds || instance.config?.qqBotAllowedGuilds || "");
      setQqBotAllowedChannels(instance.configSummary?.qqBotAllowedChannels || instance.config?.qqBotAllowedChannels || "");
      setWhatsappPhoneNumberId(instance.configSummary?.whatsappPhoneNumberId || instance.config?.whatsappPhoneNumberId || "");
      setWhatsappAllowedUsers(instance.configSummary?.whatsappAllowedUsers || instance.config?.whatsappAllowedUsers || "");
      setWhatsappAllowedChannels(instance.configSummary?.whatsappAllowedChannels || instance.config?.whatsappAllowedChannels || "");
      setDingtalkAppKey(instance.configSummary?.dingtalkAppKey || instance.config?.dingtalkAppKey || "");
      setDingtalkAllowedUsers(instance.configSummary?.dingtalkAllowedUsers || instance.config?.dingtalkAllowedUsers || "");
      setDingtalkAllowedChats(instance.configSummary?.dingtalkAllowedChats || instance.config?.dingtalkAllowedChats || "");
      setWechatMpAppId(instance.configSummary?.wechatMpAppId || instance.config?.wechatMpAppId || "");
      setWechatMpAllowedUsers(instance.configSummary?.wechatMpAllowedUsers || instance.config?.wechatMpAllowedUsers || "");
      setWechatMpAllowedChats(instance.configSummary?.wechatMpAllowedChats || instance.config?.wechatMpAllowedChats || "");
      setWeixinAccountId(instance.configSummary?.weixinAccountId || instance.config?.weixinAccountId || "");
      setWeixinBaseUrl(instance.configSummary?.weixinBaseUrl || instance.config?.weixinBaseUrl || "https://ilinkai.weixin.qq.com");
      setWeixinAllowedUsers(instance.configSummary?.weixinAllowedUsers || instance.config?.weixinAllowedUsers || "");
      setWeixinAllowedChats(instance.configSummary?.weixinAllowedChats || instance.config?.weixinAllowedChats || "");
      setWecomAppId(instance.configSummary?.wecomAppId || instance.config?.wecomAppId || "");
      setWecomAgentId(instance.configSummary?.wecomAgentId || instance.config?.wecomAgentId || "");
      setWecomAllowedUsers(instance.configSummary?.wecomAllowedUsers || instance.config?.wecomAllowedUsers || "");
      setWecomAllowedChats(instance.configSummary?.wecomAllowedChats || instance.config?.wecomAllowedChats || "");
      setWebhookUrl(instance.configSummary?.webhookUrl || instance.config?.webhookUrl || "");

      setPetEnabled(instance.configSummary?.pet?.enabled || instance.config?.pet?.enabled || false);
      setPetSlug(instance.configSummary?.pet?.slug || instance.config?.pet?.slug || "");
      setPetRenderMode(instance.configSummary?.pet?.render_mode || instance.config?.pet?.render_mode || "webgl");
      setPetScale(instance.configSummary?.pet?.scale || instance.config?.pet?.scale || 1.0);

      setSkills(instance.configSummary?.skills || instance.config?.skills || []);
    }
  }, [loadingDetail, instance.configSummary]);

  // Channel details
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramAllowedUsers, setTelegramAllowedUsers] = useState(instance.configSummary?.telegramAllowedUsers || instance.config?.telegramAllowedUsers || "");
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordAllowedGuilds, setDiscordAllowedGuilds] = useState(instance.configSummary?.discordAllowedGuilds || instance.config?.discordAllowedGuilds || "");
  const [feishuAppId, setFeishuAppId] = useState(instance.configSummary?.feishuAppId || instance.config?.feishuAppId || "");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuRegion, setFeishuRegion] = useState(instance.configSummary?.feishuRegion || instance.config?.feishuRegion || "feishu");
  const [qqBotAppId, setQqBotAppId] = useState(instance.configSummary?.qqBotAppId || instance.config?.qqBotAppId || "");
  const [qqBotSecret, setQqBotSecret] = useState("");
  const [qqBotAllowedUsers, setQqBotAllowedUsers] = useState(instance.configSummary?.qqBotAllowedUsers || instance.config?.qqBotAllowedUsers || "");
  const [qqBotAllowedGuilds, setQqBotAllowedGuilds] = useState(instance.configSummary?.qqBotAllowedGuilds || instance.config?.qqBotAllowedGuilds || "");
  const [qqBotAllowedChannels, setQqBotAllowedChannels] = useState(instance.configSummary?.qqBotAllowedChannels || instance.config?.qqBotAllowedChannels || "");
  const [whatsappPhoneNumberId, setWhatsappPhoneNumberId] = useState(instance.configSummary?.whatsappPhoneNumberId || instance.config?.whatsappPhoneNumberId || "");
  const [whatsappAccessToken, setWhatsappAccessToken] = useState("");
  const [whatsappAllowedUsers, setWhatsappAllowedUsers] = useState(instance.configSummary?.whatsappAllowedUsers || instance.config?.whatsappAllowedUsers || "");
  const [whatsappAllowedChannels, setWhatsappAllowedChannels] = useState(instance.configSummary?.whatsappAllowedChannels || instance.config?.whatsappAllowedChannels || "");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [dingtalkAppKey, setDingtalkAppKey] = useState(instance.configSummary?.dingtalkAppKey || instance.config?.dingtalkAppKey || "");
  const [dingtalkAppSecret, setDingtalkAppSecret] = useState("");
  const [dingtalkRobotSecret, setDingtalkRobotSecret] = useState("");
  const [dingtalkAllowedUsers, setDingtalkAllowedUsers] = useState(instance.configSummary?.dingtalkAllowedUsers || instance.config?.dingtalkAllowedUsers || "");
  const [dingtalkAllowedChats, setDingtalkAllowedChats] = useState(instance.configSummary?.dingtalkAllowedChats || instance.config?.dingtalkAllowedChats || "");
  const [wechatMpAppId, setWechatMpAppId] = useState(instance.configSummary?.wechatMpAppId || instance.config?.wechatMpAppId || "");
  const [wechatMpAppSecret, setWechatMpAppSecret] = useState("");
  const [wechatMpToken, setWechatMpToken] = useState("");
  const [wechatMpEncodingAesKey, setWechatMpEncodingAesKey] = useState("");
  const [wechatMpAllowedUsers, setWechatMpAllowedUsers] = useState(instance.configSummary?.wechatMpAllowedUsers || instance.config?.wechatMpAllowedUsers || "");
  const [wechatMpAllowedChats, setWechatMpAllowedChats] = useState(instance.configSummary?.wechatMpAllowedChats || instance.config?.wechatMpAllowedChats || "");
  const [weixinAccountId, setWeixinAccountId] = useState(instance.configSummary?.weixinAccountId || instance.config?.weixinAccountId || "");
  const [weixinToken, setWeixinToken] = useState("");
  const [weixinBaseUrl, setWeixinBaseUrl] = useState(instance.configSummary?.weixinBaseUrl || instance.config?.weixinBaseUrl || "https://ilinkai.weixin.qq.com");
  const [weixinAllowedUsers, setWeixinAllowedUsers] = useState(instance.configSummary?.weixinAllowedUsers || instance.config?.weixinAllowedUsers || "");
  const [weixinAllowedChats, setWeixinAllowedChats] = useState(instance.configSummary?.weixinAllowedChats || instance.config?.weixinAllowedChats || "");
  const [wecomAppId, setWecomAppId] = useState(instance.configSummary?.wecomAppId || instance.config?.wecomAppId || "");
  const [wecomAppSecret, setWecomAppSecret] = useState("");
  const [wecomToken, setWecomToken] = useState("");
  const [wecomEncodingAesKey, setWecomEncodingAesKey] = useState("");
  const [wecomAgentId, setWecomAgentId] = useState(instance.configSummary?.wecomAgentId || instance.config?.wecomAgentId || "");
  const [wecomAllowedUsers, setWecomAllowedUsers] = useState(instance.configSummary?.wecomAllowedUsers || instance.config?.wecomAllowedUsers || "");
  const [wecomAllowedChats, setWecomAllowedChats] = useState(instance.configSummary?.wecomAllowedChats || instance.config?.wecomAllowedChats || "");
  const [webhookUrl, setWebhookUrl] = useState(instance.configSummary?.webhookUrl || instance.config?.webhookUrl || "");
  const [webhookSecret, setWebhookSecret] = useState("");

  // Pets Config
  const [petEnabled, setPetEnabled] = useState<boolean>(instance.configSummary?.pet?.enabled || instance.config?.pet?.enabled || false);
  const [petSlug, setPetSlug] = useState<string>(instance.configSummary?.pet?.slug || instance.config?.pet?.slug || "");
  const [petRenderMode, setPetRenderMode] = useState<string>(instance.configSummary?.pet?.render_mode || instance.config?.pet?.render_mode || "webgl");
  const [petScale, setPetScale] = useState<number>(instance.configSummary?.pet?.scale || instance.config?.pet?.scale || 1.0);

  // Skills Configs
  const [skills, setSkills] = useState<string[]>(instance.configSummary?.skills || instance.config?.skills || []);
  const [skillTavilyApiKey, setSkillTavilyApiKey] = useState("");
  const [skillSerperApiKey, setSkillSerperApiKey] = useState("");
  const [skillGithubToken, setSkillGithubToken] = useState("");

  const [loading, setLoading] = useState(false);

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProv = e.target.value;
    setProvider(nextProv);
    const conf = providerRegistry[nextProv];
    if (conf) {
      const models = conf.models || [];
      setModel(conf.defaultModel || models[0] || "");
      setBaseUrl(conf.defaultBaseUrl || "");
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const isChannelAllowed = isDeployChannelAllowedByEntitlement(channel, externalChannelsAllowed);
      if (!isChannelAllowed) {
        showAlert({
          title: t("settings_validation_failed"),
          message: `当前所选通讯渠道 [${channel}] 已被本地配置禁用。请切换为已启用的渠道后再保存。`,
          type: "error"
        });
        setLoading(false);
        return;
      }

      const dashboardWasEnabled = (instance.config?.enableDashboard ?? instance.configSummary?.enableDashboard ?? true) !== false;
      if (enableDashboard && !dashboardWasEnabled && !password.trim()) {
        showAlert({
          title: t("settings_validation_failed"),
          message: t("settings_dashboard_reenable_password_required"),
          type: "warning"
        });
        setLoading(false);
        return;
      }

      if (password && password.length < 8) {
        showAlert({
          title: t("settings_validation_failed"),
          message: t("settings_password_too_short") || "密码长度不能少于 8 位",
          type: "warning"
        });
        setLoading(false);
        return;
      }

      // Check for deprecated or invalid provider
      const selectedProviderConf = providerRegistry[provider];
      if (!selectedProviderConf || !selectedProviderConf.enabled) {
        showAlert({
          title: t("settings_validation_failed"),
          message: t("settings_provider_invalid", { provider }),
          type: "error"
        });
        setLoading(false);
        return;
      }

      // Check for deprecated or invalid model if not custom model
      if (!isCustomModel) {
        const allowedModels = selectedProviderConf.models || [];
        if (allowedModels.length > 0 && !allowedModels.includes(model)) {
          showAlert({
            title: t("settings_validation_failed"),
            message: t("settings_model_invalid", { model }),
            type: "error"
          });
          setLoading(false);
          return;
        }
      }

      const payload: any = {
        provider, model, baseUrl, channel, agentPrompt,
        enableDashboard,
        telegramAllowedUsers, discordAllowedGuilds, feishuAppId, feishuRegion, qqBotAppId, qqBotAllowedUsers,
        qqBotAllowedGuilds, qqBotAllowedChannels, whatsappPhoneNumberId, whatsappAllowedUsers,
        whatsappAllowedChannels, dingtalkAppKey, dingtalkAllowedUsers, dingtalkAllowedChats,
        wechatMpAppId, wechatMpAllowedUsers, wechatMpAllowedChats,
        weixinAccountId, weixinBaseUrl, weixinAllowedUsers, weixinAllowedChats,
        wecomAppId, wecomAgentId, wecomAllowedUsers, wecomAllowedChats, webhookUrl,
        skills,
        confirmed_skill_ids: skills.filter(id => {
          const policy = skillPolicyRegistry[id];
          return policy?.requiresConfirmation === true;
        }),
        ...(advancedResourceConfigEnabled ? { limitsCpu, limitsMem } : {}),
        isCustomModel,
        pet: {
          enabled: petEnabled,
          slug: petSlug,
          render_mode: petRenderMode,
          scale: Math.max(0.1, Math.min(5.0, parseFloat(petScale as any) || 1.0))
        }
      };

      if (providerApiKey.trim()) payload.providerApiKey = providerApiKey.trim();
      // Always send the selected credential source. null explicitly means
      // manual-key mode and lets the server clear a previous saved credential.
      payload.providerCredentialId = providerCredentialId || null;
      if (password.trim()) payload.password = password.trim();
      if (telegramBotToken.trim()) payload.telegramBotToken = telegramBotToken.trim();
      if (discordBotToken.trim()) payload.discordBotToken = discordBotToken.trim();
      if (feishuAppSecret.trim()) payload.feishuAppSecret = feishuAppSecret.trim();
      if (qqBotSecret.trim()) payload.qqBotSecret = qqBotSecret.trim();
      if (whatsappAccessToken.trim()) payload.whatsappAccessToken = whatsappAccessToken.trim();
      if (slackBotToken.trim()) payload.slackBotToken = slackBotToken.trim();
      if (slackSigningSecret.trim()) payload.slackSigningSecret = slackSigningSecret.trim();
      if (slackAppToken.trim()) payload.slackAppToken = slackAppToken.trim();
      if (dingtalkAppSecret.trim()) payload.dingtalkAppSecret = dingtalkAppSecret.trim();
      if (dingtalkRobotSecret.trim()) payload.dingtalkRobotSecret = dingtalkRobotSecret.trim();
      if (wechatMpAppSecret.trim()) payload.wechatMpAppSecret = wechatMpAppSecret.trim();
      if (wechatMpToken.trim()) payload.wechatMpToken = wechatMpToken.trim();
      if (wechatMpEncodingAesKey.trim()) payload.wechatMpEncodingAesKey = wechatMpEncodingAesKey.trim();
      if (weixinToken.trim()) payload.weixinToken = weixinToken.trim();
      if (wecomAppSecret.trim()) payload.wecomAppSecret = wecomAppSecret.trim();
      if (wecomToken.trim()) payload.wecomToken = wecomToken.trim();
      if (wecomEncodingAesKey.trim()) payload.wecomEncodingAesKey = wecomEncodingAesKey.trim();
      if (webhookSecret.trim()) payload.webhookSecret = webhookSecret.trim();

      // Skills keys
      if (skillTavilyApiKey.trim()) payload.skillTavilyApiKey = skillTavilyApiKey.trim();
      if (skillSerperApiKey.trim()) payload.skillSerperApiKey = skillSerperApiKey.trim();
      if (skillGithubToken.trim()) payload.skillGithubToken = skillGithubToken.trim();

      // Sanitize channel specific keys in payload to prevent pollution
      if (channel !== "telegram") {
        delete payload.telegramAllowedUsers;
        delete payload.telegramBotToken;
      }
      if (channel !== "discord") {
        delete payload.discordAllowedGuilds;
        delete payload.discordBotToken;
      }
      if (channel !== "feishu" && channel !== "lark") {
        delete payload.feishuAppId;
        delete payload.feishuAppSecret;
        delete payload.feishuRegion;
      }
      if (channel !== "qq_bot") {
        delete payload.qqBotAppId;
        delete payload.qqBotSecret;
        delete payload.qqBotAllowedUsers;
        delete payload.qqBotAllowedGuilds;
        delete payload.qqBotAllowedChannels;
      }
      if (channel !== "whatsapp") {
        delete payload.whatsappPhoneNumberId;
        delete payload.whatsappAccessToken;
        delete payload.whatsappAllowedUsers;
        delete payload.whatsappAllowedChannels;
      }
      if (channel !== "slack") {
        delete payload.slackBotToken;
        delete payload.slackSigningSecret;
        delete payload.slackAppToken;
      }
      if (channel !== "dingtalk") {
        delete payload.dingtalkAppKey;
        delete payload.dingtalkAppSecret;
        delete payload.dingtalkRobotSecret;
        delete payload.dingtalkAllowedUsers;
        delete payload.dingtalkAllowedChats;
      }
      if (channel !== "wechat") {
        delete payload.wechatAppId;
        delete payload.wechatAppSecret;
        delete payload.wechatAgentId;
      }
      if (channel !== "wechat_mp") {
        delete payload.wechatMpAppId;
        delete payload.wechatMpAppSecret;
        delete payload.wechatMpToken;
        delete payload.wechatMpEncodingAesKey;
        delete payload.wechatMpAllowedUsers;
        delete payload.wechatMpAllowedChats;
      }
      if (channel !== "weixin") {
        delete payload.weixinAccountId;
        delete payload.weixinToken;
        delete payload.weixinBaseUrl;
        delete payload.weixinAllowedUsers;
        delete payload.weixinAllowedChats;
      }
      if (channel !== "wecom") {
        delete payload.wecomAppId;
        delete payload.wecomAppSecret;
        delete payload.wecomToken;
        delete payload.wecomEncodingAesKey;
        delete payload.wecomAgentId;
        delete payload.wecomAllowedUsers;
        delete payload.wecomAllowedChats;
      }
      if (channel !== "webhook") {
        delete payload.webhookUrl;
        delete payload.webhookSecret;
      }

      await api.put(`/api/instances/${instance.id}/config`, payload);
      showToast(t("settings_save_success") || "配置已保存", "success");
      onSave();
    } catch (e: any) {
      console.error("Failed to save and restart:", e);
      showAlert({
        title: "保存失败",
        message: "未能成功保存您的实例配置。",
        type: "error",
        details: e.message || t("settings_save_failed_fallback")
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end md:items-center justify-center backdrop-blur-xs md:p-4 animate-in fade-in duration-200">
      {/* Mobile background overlay click handler */}
      <div className="absolute inset-0 z-0" onClick={onClose} />

      <div className="bg-surface rounded-t-2xl md:rounded-xl w-full max-w-2xl overflow-hidden shadow-lg animate-in fade-in slide-in-from-bottom-6 md:zoom-in-98 duration-200 flex flex-col max-h-[90vh] md:max-h-[85vh] relative z-10 border border-slate-200/80 dark:border-slate-800">

        {/* Mobile handle styling */}
        <div className="w-full flex justify-center py-2.5 md:hidden bg-slate-50/50 dark:bg-slate-950/40 border-b border-outline/80">
            <div className="w-12 h-1 bg-slate-200 dark:bg-slate-700 rounded-full" />
        </div>

        <div className="px-5 py-4 border-b border-slate-200/60 dark:border-slate-800 flex items-center justify-between bg-surface shrink-0">
          <div>
            <h3 className="text-base font-semibold text-content">{t("settings_modal_title")}</h3>
            <p className="text-[13px] text-content-muted font-mono mt-0.5">{t("settings_modal_subtitle", { name: instance.name })}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-control-hover border border-transparent hover:border-slate-200/40 dark:hover:border-slate-700 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1 bg-slate-50/30 dark:bg-slate-950/40">
          <div className="p-3 bg-amber-50/50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[13px] rounded-lg border border-amber-200/40 dark:border-amber-900/40 shadow-xs leading-relaxed">
            {t("settings_restart_notice")}
          </div>

          <AppSettingsLLMSection
            password={password} setPassword={setPassword}
            provider={provider} setProvider={setProvider}
            handleProviderChange={handleProviderChange}
            model={model} setModel={setModel}
            isCustomModel={isCustomModel} setIsCustomModel={setIsCustomModel}
            baseUrl={baseUrl} setBaseUrl={setBaseUrl}
            providerApiKey={providerApiKey} setProviderApiKey={setProviderApiKey}
            providerCredentialId={providerCredentialId} setProviderCredentialId={setProviderCredentialId}
            credentials={credentials}
          />

          <AppSettingsChannelSection
            channel={channel} setChannel={setChannel}
            externalChannelsAllowed={externalChannelsAllowed}
            telegramBotToken={telegramBotToken} setTelegramBotToken={setTelegramBotToken}
            telegramAllowedUsers={telegramAllowedUsers} setTelegramAllowedUsers={setTelegramAllowedUsers}
            discordBotToken={discordBotToken} setDiscordBotToken={setDiscordBotToken}
            discordAllowedGuilds={discordAllowedGuilds} setDiscordAllowedGuilds={setDiscordAllowedGuilds}
            feishuAppId={feishuAppId} setFeishuAppId={setFeishuAppId}
            feishuAppSecret={feishuAppSecret} setFeishuAppSecret={setFeishuAppSecret}
            feishuRegion={feishuRegion} setFeishuRegion={setFeishuRegion}
            qqBotAppId={qqBotAppId} setQqBotAppId={setQqBotAppId}
            qqBotSecret={qqBotSecret} setQqBotSecret={setQqBotSecret}
            qqBotAllowedUsers={qqBotAllowedUsers} setQqBotAllowedUsers={setQqBotAllowedUsers}
            qqBotAllowedGuilds={qqBotAllowedGuilds} setQqBotAllowedGuilds={setQqBotAllowedGuilds}
            qqBotAllowedChannels={qqBotAllowedChannels} setQqBotAllowedChannels={setQqBotAllowedChannels}
            whatsappPhoneNumberId={whatsappPhoneNumberId} setWhatsappPhoneNumberId={setWhatsappPhoneNumberId}
            whatsappAccessToken={whatsappAccessToken} setWhatsappAccessToken={setWhatsappAccessToken}
            whatsappAllowedUsers={whatsappAllowedUsers} setWhatsappAllowedUsers={setWhatsappAllowedUsers}
            whatsappAllowedChannels={whatsappAllowedChannels} setWhatsappAllowedChannels={setWhatsappAllowedChannels}
            slackBotToken={slackBotToken} setSlackBotToken={setSlackBotToken}
            slackSigningSecret={slackSigningSecret} setSlackSigningSecret={setSlackSigningSecret}
            slackAppToken={slackAppToken} setSlackAppToken={setSlackAppToken}
            dingtalkAppKey={dingtalkAppKey} setDingtalkAppKey={setDingtalkAppKey}
            dingtalkAppSecret={dingtalkAppSecret} setDingtalkAppSecret={setDingtalkAppSecret}
            dingtalkRobotSecret={dingtalkRobotSecret} setDingtalkRobotSecret={setDingtalkRobotSecret}
            dingtalkAllowedUsers={dingtalkAllowedUsers} setDingtalkAllowedUsers={setDingtalkAllowedUsers}
            dingtalkAllowedChats={dingtalkAllowedChats} setDingtalkAllowedChats={setDingtalkAllowedChats}
            wechatMpAppId={wechatMpAppId} setWechatMpAppId={setWechatMpAppId}
            wechatMpAppSecret={wechatMpAppSecret} setWechatMpAppSecret={setWechatMpAppSecret}
            wechatMpToken={wechatMpToken} setWechatMpToken={setWechatMpToken}
            wechatMpEncodingAesKey={wechatMpEncodingAesKey} setWechatMpEncodingAesKey={setWechatMpEncodingAesKey}
            wechatMpAllowedUsers={wechatMpAllowedUsers} setWechatMpAllowedUsers={setWechatMpAllowedUsers}
            wechatMpAllowedChats={wechatMpAllowedChats} setWechatMpAllowedChats={setWechatMpAllowedChats}
            weixinAccountId={weixinAccountId} setWeixinAccountId={setWeixinAccountId}
            weixinToken={weixinToken} setWeixinToken={setWeixinToken}
            weixinBaseUrl={weixinBaseUrl} setWeixinBaseUrl={setWeixinBaseUrl}
            weixinAllowedUsers={weixinAllowedUsers} setWeixinAllowedUsers={setWeixinAllowedUsers}
            weixinAllowedChats={weixinAllowedChats} setWeixinAllowedChats={setWeixinAllowedChats}
            wecomAppId={wecomAppId} setWecomAppId={setWecomAppId}
            wecomAppSecret={wecomAppSecret} setWecomAppSecret={setWecomAppSecret}
            wecomToken={wecomToken} setWecomToken={setWecomToken}
            wecomEncodingAesKey={wecomEncodingAesKey} setWecomEncodingAesKey={setWecomEncodingAesKey}
            wecomAgentId={wecomAgentId} setWecomAgentId={setWecomAgentId}
            wecomAllowedUsers={wecomAllowedUsers} setWecomAllowedUsers={setWecomAllowedUsers}
            wecomAllowedChats={wecomAllowedChats} setWecomAllowedChats={setWecomAllowedChats}
            webhookUrl={webhookUrl} setWebhookUrl={setWebhookUrl}
            webhookSecret={webhookSecret} setWebhookSecret={setWebhookSecret}
          />

          <div className="p-5 bg-surface border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-3 shadow-2xs">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("settings_personality_title")}</h4>
            <div className="space-y-1.5">
              <Label className="text-[13px] font-medium text-content-muted">{t("settings_personality_prompt_label")}</Label>
              <textarea
                value={agentPrompt}
                onChange={e => setAgentPrompt(e.target.value)}
                className="flex min-h-[120px] max-h-[300px] overflow-y-auto resize-y w-full rounded-lg border border-outline bg-surface px-3.5 py-2.5 text-[13px] text-content placeholder:text-slate-400 focus:border-slate-400 dark:focus:border-slate-500 focus:ring-1 focus:ring-slate-400 outline-none transition-all mt-1.5 shadow-3xs leading-relaxed"
                placeholder={t("settings_personality_placeholder")}
              />
            </div>
          </div>

          {/* Pet Configuration */}
          <div className="p-5 bg-surface border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-4 shadow-2xs">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">{t("settings_pet_title", "Pet Display")}</h4>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("settings_pet_enabled", "Enable Pet")}</Label>
                <p className="text-[13px] text-content-muted mt-0.5 leading-snug max-w-[85%]">{t("settings_pet_desc", "Display a virtual pet character")}</p>
              </div>
              <div
                className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${petEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}
                onClick={() => setPetEnabled(!petEnabled)}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${petEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>

            {petEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-outline">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-content-muted">{t("settings_pet_slug", "Pet Slug")}</Label>
                  <select
                    value={petSlug}
                    onChange={e => setPetSlug(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-outline bg-surface px-3 text-[13px] text-content focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all shadow-3xs"
                  >
                    <option value="">{t("settings_pet_slug_none", "-- Select --")}</option>
                    <option value="cat">Cat</option>
                    <option value="dog">Dog</option>
                    <option value="fox">Fox</option>
                    <option value="bunny">Bunny</option>
                    <option value="panda">Panda</option>
                    {petSlug && !["cat", "dog", "fox", "bunny", "panda"].includes(petSlug) && (
                      <option value={petSlug}>{petSlug} (Custom)</option>
                    )}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-content-muted">{t("settings_pet_render_mode", "Render Mode")}</Label>
                  <select
                    value={petRenderMode}
                    onChange={e => setPetRenderMode(e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-outline bg-surface px-3 text-[13px] text-content focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all shadow-3xs"
                  >
                    <option value="webgl">WebGL</option>
                    <option value="css">CSS</option>
                    <option value="image">Image</option>
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-[13px] font-medium text-content-muted">{t("settings_pet_scale", "Scale")}</Label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="5.0"
                    value={petScale}
                    onChange={e => setPetScale(parseFloat(e.target.value) || 1.0)}
                    className="flex h-9 w-full rounded-lg border border-outline bg-surface px-3 text-[13px] text-content placeholder:text-content-muted focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all shadow-3xs"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="p-5 bg-surface border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-4 shadow-2xs">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Web UI (Dashboard)</h4>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">{t("settings_dashboard_enable_label")}</Label>
                <p className="text-[13px] text-content-muted mt-0.5 leading-snug max-w-[85%]">{t("settings_dashboard_enable_desc")}</p>
              </div>
              <div
                className={`w-11 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${enableDashboard ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'}`}
                onClick={() => setEnableDashboard(!enableDashboard)}
              >
                <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform ${enableDashboard ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>
          </div>

          {advancedResourceConfigEnabled && currentUser?.role === 'admin' && (
            <div className="p-5 bg-surface border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-3.5 shadow-2xs">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted flex items-center gap-1.5 border-b border-outline pb-2">
                <span>{t("settings_limits_title")}</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-content-muted">{t("settings_limits_cpu")}</Label>
                  <select
                    value={limitsCpu}
                    onChange={(e) => setLimitsCpu(e.target.value)}
                    className="w-full flex h-9 rounded-lg border border-outline bg-surface px-3 text-[13px] font-medium text-content-secondary shadow-3xs hover:border-outline-strong focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all mt-1.5"
                  >
                    <option value="0.1">{t("settings_cpu_option_01")}</option>
                    <option value="0.25">{t("settings_cpu_option_025")}</option>
                    <option value="0.5">{t("settings_cpu_option_05")}</option>
                    <option value="1.0">{t("settings_cpu_option_10")}</option>
                    <option value="2.0">{t("settings_cpu_option_20")}</option>
                    <option value="unlimited">{t("settings_option_unlimited")}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] font-medium text-content-muted">{t("settings_limits_mem")}</Label>
                  <select
                    value={limitsMem}
                    onChange={(e) => setLimitsMem(e.target.value)}
                    className="w-full flex h-9 rounded-lg border border-outline bg-surface px-3 text-[13px] font-medium text-content-secondary shadow-3xs hover:border-outline-strong focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none transition-all mt-1.5"
                  >
                    <option value="128MB">{t("settings_ram_option_128")}</option>
                    <option value="256MB">{t("settings_ram_option_256")}</option>
                    <option value="512MB">{t("settings_ram_option_512")}</option>
                    <option value="1GB">{t("settings_ram_option_1")}</option>
                    <option value="2GB">{t("settings_ram_option_2")}</option>
                    <option value="unlimited">{t("settings_option_unlimited")}</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-content-muted font-normal leading-normal">
                {t("settings_limits_desc")}
              </p>
            </div>
          )}

          <AppSettingsSkillsSection
            skills={skills} setSkills={setSkills}
            skillTavilyApiKey={skillTavilyApiKey} setSkillTavilyApiKey={setSkillTavilyApiKey}
            skillSerperApiKey={skillSerperApiKey} setSkillSerperApiKey={setSkillSerperApiKey}
            skillGithubToken={skillGithubToken} setSkillGithubToken={setSkillGithubToken}
            currentUser={currentUser}
          />
          {/* Add extra padding at the bottom for mobile so content isn't obscured by safe areas or sticky footer */}
          <div className="h-4 md:hidden"></div>
        </div>

        <div className="px-5 py-3.5 bg-surface border-t border-slate-200/60 dark:border-slate-800 flex flex-col-reverse md:flex-row justify-end gap-2.5 shrink-0">
          <Button variant="outline" type="button" className="w-full md:w-auto text-[13px] font-medium rounded-lg h-9 text-slate-600 border-slate-200 hover:bg-surface-muted dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" onClick={onClose} disabled={loading}>{t("action_cancel")}</Button>
          <Button type="button" variant="primary" className="h-9 w-full rounded-lg text-[13px] font-medium md:w-auto" onClick={handleSave} disabled={loading}>
            {loading ? t("settings_saving_btn") : t("settings_save_btn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
