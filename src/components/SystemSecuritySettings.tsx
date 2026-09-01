import React, { useState, useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Shield, ShieldAlert, ShieldCheck, Loader2, AlertTriangle, AlertCircle, Info, HardDrive, Key, Server, Cpu, Lock } from "lucide-react";
import { Button, Card, cn } from "./ui";
import { useFeedback } from "./FeedbackProvider";
import { api } from "../lib/api";
import { LocalResourcePolicyCard } from "./LocalResourcePolicyCard";

export function SystemSecuritySettings({ currentUser, advancedResourceConfigEnabled = false }: { currentUser: any, advancedResourceConfigEnabled?: boolean }) {
  const { showToast, showAlert, showConfirm } = useFeedback();
  const { t } = useTranslation("deploy");
  const navigate = useNavigate();
  const [settings, setSettings] = useState<{
    ENABLE_DOCKER_SOCKET_SKILL: boolean;
    admin_docker_socket_enabled: boolean;
    encryptionKeyConfigured?: boolean;
    maxInstanceCount?: number | string;
    defaultDiskMb?: number;
    localAdminIsDefaultPassword?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get("/api/system/settings");
      if (data) {
        setSettings({
          ENABLE_DOCKER_SOCKET_SKILL: data.ENABLE_DOCKER_SOCKET_SKILL === true,
          admin_docker_socket_enabled: data.admin_docker_socket_enabled === true,
          encryptionKeyConfigured: data.encryptionKeyConfigured ?? true,
          maxInstanceCount: data.maxInstanceCount || 10,
          defaultDiskMb: data.defaultDiskMb || 4096,
          localAdminIsDefaultPassword: Boolean(data.localAdminIsDefaultPassword)
        });
      }
    } catch (err: any) {
      setError(err.message || t("systemSecurity.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleToggleDockerSocket = async () => {
    if (!settings) return;

    const newValue = !settings.admin_docker_socket_enabled;

    if (newValue) {
      const confirmed = await showConfirm({
        title: t("systemSecurity.confirm.title"),
        message: t("systemSecurity.confirm.message"),
        type: "danger",
        confirmText: t("systemSecurity.confirm.enable"),
        cancelText: t("systemSecurity.confirm.cancel")
      });
      if (!confirmed) return;
    }

    setUpdating(true);
    try {
      const data = await api.patch("/api/system/settings", {
        admin_docker_socket_enabled: newValue,
      });
      if (data) {
        setSettings(prev => prev ? ({
          ...prev,
          ENABLE_DOCKER_SOCKET_SKILL: data.ENABLE_DOCKER_SOCKET_SKILL === true,
          admin_docker_socket_enabled: data.admin_docker_socket_enabled === true,
        }) : null);
        showToast(t("systemSecurity.updateSuccess"), "success");
      }
    } catch (err: any) {
      showAlert({
        title: t("systemSecurity.updateFailedTitle"),
        message: t("systemSecurity.updateFailedMessage"),
        type: "error",
        details: err.message
      });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-surface border border-outline rounded-3xl shadow-sm">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-content-muted">{t("systemSecurity.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 bg-red-50 border border-red-100 flex flex-col items-center justify-center text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mb-3" />
        <h3 className="text-base font-bold text-red-900 mb-1">{t("systemSecurity.fetchFailed")}</h3>
        <p className="text-sm text-red-600 mb-4 max-w-md">{error}</p>
        <Button onClick={fetchSettings} size="sm" className="bg-red-600 hover:bg-red-700 text-white rounded-xl">
          {t("systemSecurity.reload")}
        </Button>
      </Card>
    );
  }

  const isEnvEnabled = settings?.ENABLE_DOCKER_SOCKET_SKILL === true;
  const isDbEnabled = settings?.admin_docker_socket_enabled === true;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-content flex items-center gap-2">
          <Shield className="w-5 h-5 text-indigo-600" />
          {t("systemSecurity.title")}
        </h2>
        <p className="text-sm text-content-muted">{t("systemSecurity.description")}</p>
      </div>

      <Card className="p-5 bg-surface border border-blue-100 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-content">{t("firstRun.deploymentMode.settingsTitle")}</h3>
          <p className="mt-1 text-xs text-content-muted">{t("firstRun.deploymentMode.settingsDescription")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/setup")}>{t("firstRun.deploymentMode.manage")}</Button>
      </Card>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Check 1: Admin Password */}
        <Card className="p-5 bg-surface border border-outline shadow-sm flex items-start gap-3.5">
          <div className={cn("p-2.5 rounded-xl shrink-0", settings?.localAdminIsDefaultPassword ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600")}>
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-content mb-1">{t("systemSecurity.adminPassword.title")}</h4>
            <p className="text-xs text-content-muted leading-normal">
              {t(settings?.localAdminIsDefaultPassword ? "systemSecurity.adminPassword.default" : "systemSecurity.adminPassword.secure")}
            </p>
          </div>
        </Card>

        {/* Check 2: ENCRYPTION_KEY */}
        <Card className="p-5 bg-surface border border-outline shadow-sm flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl shrink-0 bg-emerald-50 text-emerald-600">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-content mb-1">{t("systemSecurity.encryption.title")}</h4>
            <p className="text-xs text-content-muted leading-normal">
              {t("systemSecurity.encryption.description")}
            </p>
          </div>
        </Card>

        {/* Check 3: Host Resources */}
        <Card className="p-5 bg-surface border border-outline shadow-sm flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl shrink-0 bg-blue-50 text-blue-600">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-content mb-1">{t("systemSecurity.resources.title")}</h4>
            <p className="text-xs text-content-muted leading-normal">
              {t("systemSecurity.resources.description", { max: settings?.maxInstanceCount || 10, disk: settings?.defaultDiskMb || 4096 })}
            </p>
          </div>
        </Card>
      </div>

      {advancedResourceConfigEnabled && <LocalResourcePolicyCard />}

      <div className="grid grid-cols-1 gap-6">
        {/* Environment-level Gate Switch (ENABLE_DOCKER_SOCKET_SKILL) */}
        <Card className="p-6 bg-surface border border-outline shadow-sm relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-bold text-content flex items-center gap-2">
                <span>{t("systemSecurity.environmentGate.title")}</span>
              </h3>
              <p className="text-xs text-content-muted leading-relaxed font-normal">
                {t("systemSecurity.environmentGate.description")}
              </p>
              <div className="text-xs text-content-muted font-mono mt-1">
                {t("systemSecurity.environmentGate.variable")}: <code className="bg-surface-muted px-1 py-0.5 rounded text-content-secondary font-bold">ENABLE_DOCKER_SOCKET_SKILL</code>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:self-center">
              <span className={cn(
                "px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5",
                isEnvEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-surface-muted text-content-muted border-outline"
              )}>
                <div className={cn("w-1.5 h-1.5 rounded-full", isEnvEnabled ? "bg-emerald-500" : "bg-slate-400")} />
                {t(isEnvEnabled ? "systemSecurity.environmentGate.enabled" : "systemSecurity.environmentGate.disabled")}
              </span>
            </div>
          </div>
        </Card>

        {/* Database-level Gate Switch (admin_docker_socket_enabled) */}
        <Card className="p-6 bg-surface border border-outline shadow-sm relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-bold text-content flex items-center gap-2">
                <span>{t("systemSecurity.dockerAuthorization.title")}</span>
                {updating && (
                  <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                )}
              </h3>
              <p className="text-xs text-content-muted leading-relaxed font-normal">
                <Trans
                  t={t}
                  i18nKey="systemSecurity.dockerAuthorization.description"
                  components={{
                    docker: <code className="bg-surface-muted px-1 rounded text-red-600 font-semibold font-mono" />,
                    dockerEngine: <code className="bg-surface-muted px-1 rounded text-red-600 font-semibold font-mono" />,
                    socket: <code className="bg-surface-muted px-1 rounded text-content-secondary font-semibold font-mono" />
                  }}
                />
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 sm:self-center shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-content-muted">
                  {t("systemSecurity.dockerAuthorization.toggleLabel")}
                </span>
                <button
                  type="button"
                  onClick={handleToggleDockerSocket}
                  disabled={updating || !isEnvEnabled}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                    isDbEnabled ? "bg-blue-600" : "bg-surface-muted",
                    (updating || !isEnvEnabled) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out",
                      isDbEnabled ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
