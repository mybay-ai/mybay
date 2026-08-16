import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Eye, EyeOff, Key, ShieldCheck, User, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { validateAvatarUrl } from "../../../shared/avatarValidation";
import { AUTH_CONFIG, validatePassword } from "../../../shared/authValidation";
import { APP_ROUTES } from "../../constants/routes";
import { useInstanceQuota } from "../../hooks/useInstanceQuota";
import { api, apiFetch } from "../../lib/api";
import { Button, cn, Input, Label } from "../ui";

export function ProfileModal({ user, onClose, onUpdate, onSilentUpdate }: { user: any, onClose: () => void, onUpdate: (user: any) => void, onSilentUpdate?: (user: any) => void }) {
  const { t } = useTranslation(["auth", "common"]);
  const navigate = useNavigate();
  const profileQuota = useInstanceQuota(user, []);
  const profilePlanCode = String(profileQuota.subscriptionPlan || profileQuota.plan || user?.subscriptionPlan || user?.subscription_plan || (user?.role === "admin" ? "admin" : "free")).toLowerCase();
  const normalizedProfilePlan = ["free", "personal", "pro", "admin"].includes(profilePlanCode) ? profilePlanCode : "unknown";
  const profileActiveInstances = Number(profileQuota.activeInstances ?? 0);
  const profileMaxInstances = Number(profileQuota.maxActiveInstances ?? 0);
  const profileDiskUsed = Number(profileQuota.allocatedDiskMb ?? 0);
  const profileDiskLimit = profileQuota.totalDiskQuotaMb === null || profileQuota.totalDiskQuotaMb === undefined ? null : Number(profileQuota.totalDiskQuotaMb);
  const formatProfileMb = (value: number | null) => value === null || value >= 999999 ? t("planUnlimited") : value >= 1024 ? `${Number((value / 1024).toFixed(1))} GB` : `${value} MB`;
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');

  // Tab 1: Profile State
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileSuccessMessage, setProfileSuccessMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [presets, setPresets] = useState<any[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [quotaSummary, setQuotaSummary] = useState<any | null>(null);
  const [quotaSummaryLoading, setQuotaSummaryLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file type verification
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      setProfileError(t("avatarUploadInvalidType"));
      return;
    }

    // Client-side file size verification (1MB max)
    if (file.size > 1 * 1024 * 1024) {
      setProfileError(t("avatarUploadTooLarge"));
      return;
    }

    const formData = new FormData();
    formData.append("avatarFile", file);

    setUploading(true);
    setProfileError("");
    setProfileSuccess(false);

    try {
      const data = await apiFetch("/api/auth/me/avatar/upload", {
        method: "POST",
        body: formData
      });

      if (data && data.success) {
        setAvatarUrl(data.avatar_url);
        setProfileSuccess(true);
        setProfileSuccessMessage(t("avatarUploadSuccess"));
        onUpdate({ ...user, avatar_url: data.avatar_url });
        setTimeout(() => {
          setProfileSuccess(false);
        }, 1500);
      } else {
        setProfileError(data?.error || t("avatarUploadFailed"));
      }
    } catch (err: any) {
      setProfileError(err?.data?.error || err?.message || t("avatarUploadNetworkError"));
    } finally {
      setUploading(false);
    }
  };

  // Sync preset avatars when tab is profile
  useEffect(() => {
    if (activeTab === 'profile') {
      setPresetsLoading(true);
      api.get("/api/auth/avatar-presets")
        .then(data => {
          if (Array.isArray(data)) {
            setPresets(data);
          }
        })
        .catch(err => {
          console.error("Failed to load avatar presets:", err);
        })
        .finally(() => {
          setPresetsLoading(false);
        });
    }
  }, [activeTab]);

  // Tab 3: Password Update State
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const passwordValidation = password ? validatePassword(password, user.username) : { valid: true };

  // Sync latest user profile dynamically from server on modal mount
  useEffect(() => {
    api.get("/api/auth/me")
      .then(data => {
        if (data && data.success) {
          if (onSilentUpdate) {
            onSilentUpdate({
              id: data.id,
              username: data.username,
              role: data.role,
              avatar_url: data.avatar_url,
            });
          }
          if (data.avatar_url) {
            setAvatarUrl(data.avatar_url);
          }
        }
      })
      .catch(err => {
        console.error("ProfileModal mount sync failed:", err);
      });
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileSuccess(false);

    const validation = validateAvatarUrl(avatarUrl);
    if (!validation.valid) {
      if (validation.reason === "invalid_protocol") {
        setProfileError(t("profileErrorInvalidProtocol"));
      } else {
        setProfileError(t("profileErrorInvalidUrl"));
      }
      return;
    }

    setProfileLoading(true);

    try {
      const data = await api.put(`/api/auth/users/${user.id}/profile`, { avatar_url: avatarUrl });
      if (data && data.success) {
        setProfileSuccess(true);
        setProfileSuccessMessage(t("profileSuccessSaveAvatar"));
        setTimeout(() => {
          onUpdate({ ...user, avatar_url: avatarUrl });
          setProfileSuccess(false);
        }, 1000);
      } else {
        setProfileError(data?.error || t("profileErrorSaveAvatar"));
      }
    } catch (err: any) {
      setProfileError(err?.data?.error || err?.message || t("profileErrorNetwork"));
    } finally {
      setProfileLoading(false);
    }
  };

  // Submit Password Security Updates
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (!password || !confirmPassword) {
      setPasswordError(t("passwordErrorEmpty"));
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError(t("passwordErrorMatch"));
      return;
    }

    if (!passwordValidation.valid) {
      setPasswordError(passwordValidation.message || t("validationErrorPassword"));
      return;
    }

    setPasswordLoading(true);
    try {
      const data = await api.put(`/api/auth/users/${user.id}/profile`, { password, confirmPassword });
      if (data && data.success) {
        setPasswordSuccess(true);

        // Clear password fields immediately after a successful update; do not retain secrets in component state.
        setPassword("");
        setConfirmPassword("");

        setTimeout(() => {
          setPasswordSuccess(false);
        }, 3000);
      } else {
        setPasswordError(data?.error || t("passwordErrorChange"));
      }
    } catch (err: any) {
      setPasswordError(err?.data?.error || err?.message || t("passwordErrorNetwork"));
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end md:items-center justify-center backdrop-blur-sm md:p-4">
      <div className="absolute inset-0 z-0" onClick={onClose} />
      <div className="bg-surface rounded-t-3xl md:rounded-2xl w-full max-w-md overflow-hidden shadow-xl animate-in fade-in slide-in-from-bottom-8 md:zoom-in-95 duration-300 relative z-10 pb-4 md:pb-0 border border-outline">
        <div className="w-full flex justify-center py-2 md:hidden">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>

        {/* Header Title */}
        <div className="px-6 py-4 border-b border-outline flex items-center justify-between bg-surface-muted/50">
          <div>
            <h3 className="text-base font-bold text-content">{t("profileTitle")}</h3>
            <p className="text-content-muted text-[10px] tracking-tight">{t("profileSubtitle")}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 bg-surface hover:bg-control-hover border border-outline rounded-full text-content-muted hover:text-content-secondary transition-all cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Buttons Segment */}
        <div className="px-6 pt-3 flex gap-1 border-b border-outline bg-surface-muted/20">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer",
              activeTab === 'profile'
                ? "border-blue-600 text-blue-600 hover:text-blue-700"
                : "border-transparent text-content-muted hover:text-content"
            )}
          >
            <User className="w-3.5 h-3.5" />
            <span>{t("tabProfile")}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('password')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer",
              activeTab === 'password'
                ? "border-blue-600 text-blue-600 hover:text-blue-700"
                : "border-transparent text-content-muted hover:text-content"
            )}
          >
            <Key className="w-3.5 h-3.5" />
            <span>{t("tabPassword")}</span>
          </button>
        </div>

        {/* Tab Content Box */}
        <div id="modal-container" className="p-6">

          {/* TAB 1: Base profile (Avatar) */}
          {activeTab === 'profile' && (
            <form onSubmit={handleProfileSubmit} className="space-y-4">
              {profileError && (
                <div className="p-3 bg-status-danger-bg border border-status-danger-border text-status-danger-text text-xs rounded-md flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{profileError}</span>
                </div>
              )}
              {profileSuccess && (
                <div className="p-3 bg-status-success-bg border border-status-success-border text-status-success-text text-xs rounded-md flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-status-success-text shrink-0 animate-bounce" />
                  <span className="font-semibold">{profileSuccessMessage || t("profileSuccessSaveAvatar")}</span>
                </div>
              )}

              <div className="flex flex-col items-center gap-3">
                <label className="relative group w-20 h-20 rounded-full bg-control-hover border-2 border-outline overflow-hidden flex items-center justify-center text-2xl font-semibold text-content-muted cursor-pointer transition-all hover:border-blue-500 shrink-0">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={t("avatarPreviewAlt")} className="w-full h-full object-cover" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-[10px] text-white transition-opacity font-medium select-none">
                    {uploading ? t("avatarUploading") : t("avatarUploadClick")}
                  </div>
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={uploading}
                  />
                </label>
                <div className="text-center">
                  <div className="text-sm font-semibold text-content">{user.username}</div>
                  <div className="text-[10px] text-content-muted font-mono mt-0.5">UID: {user.id}</div>
                </div>
              </div>

              <div data-profile-plan-card="true" className="rounded-2xl border border-outline bg-surface-muted/70 p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium text-content-muted">{t("currentPlan")}</div>
                    <div className="mt-1 text-base font-semibold text-content">{t(`planNames.${normalizedProfilePlan}`)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(APP_ROUTES.DASHBOARD);
                    }}
                    className="shrink-0 rounded-xl border border-blue-100 bg-surface px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    {t("planViewDetails")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-outline bg-surface px-3 py-2">
                    <div className="text-content-muted">{t("planInstancesUsage")}</div>
                    <div className="mt-1 font-semibold text-content">{profileQuota.loading ? t("planNotReady") : `${profileActiveInstances} / ${profileMaxInstances || t("planUnlimited")}`}</div>
                  </div>
                  <div className="rounded-xl border border-outline bg-surface px-3 py-2">
                    <div className="text-content-muted">{t("planDiskUsage")}</div>
                    <div className="mt-1 font-semibold text-content">{profileQuota.loading ? t("planNotReady") : `${formatProfileMb(profileDiskUsed)} / ${formatProfileMb(profileDiskLimit)}`}</div>
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="avatar-input">{t("avatarLabel")}</Label>
                <Input
                  id="avatar-input"
                  className="mt-1 border-outline"
                  placeholder={t("avatarUrlPlaceholder")}
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                />
                <p data-avatar-helper="true" className="text-xs text-content-muted mt-1.5 leading-relaxed">{t("avatarHelperText")}</p>
              </div>

              {/* Preset Avatar Selection Area */}
              <div className="space-y-2 mt-4">
                <Label className="text-xs font-medium text-content-muted">
                  {t("choosePresetAvatar")}
                </Label>
                {presetsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-content-muted py-2">
                    <span className="w-3.5 h-3.5 border-2 border-outline-strong border-t-transparent rounded-full animate-spin" />
                    <span>{t("loadingPresetAvatars")}</span>
                  </div>
                ) : presets.length > 0 ? (
                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 p-3 bg-surface-muted rounded-lg border border-outline max-h-32 overflow-y-auto">
                    {presets.map((preset) => {
                      const isSelected = avatarUrl === preset.image_url;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setAvatarUrl(preset.image_url)}
                          className={`relative w-8 h-8 rounded-full overflow-hidden border transition-all duration-150 shrink-0 select-none cursor-pointer focus:outline-none ${
                            isSelected
                              ? "border-blue-500 ring-2 ring-blue-100 scale-105 font-medium"
                              : "border-outline hover:border-outline-strong hover:scale-105 font-normal"
                          }`}
                          title={preset.name}
                        >
                          <img
                            src={preset.image_url}
                            alt={preset.name}
                            className="w-full h-full object-cover animate-fade-in"
                            referrerPolicy="no-referrer"
                          />
                          {isSelected && (
                            <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-content-muted py-2">
                    {t("noPresetAvatarsAvailable")}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <Button type="submit" variant="primary" className="h-11 w-full" disabled={profileLoading}>
                  {profileLoading ? t("profileSaving") : (profileSuccess ? t("profileSaved") : t("profileSaveBtn"))}
                </Button>
              </div>
            </form>
          )}

          {/* TAB 3: Change Password Panel */}
          {activeTab === 'password' && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {passwordError && (
                <div className="p-3 bg-status-danger-bg border border-status-danger-border text-status-danger-text text-xs rounded-md flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}
              {passwordSuccess && (
                <div className="p-3 bg-status-success-bg border border-status-success-border text-status-success-text text-xs rounded-md flex items-center gap-1.5 animate-bounce">
                  <ShieldCheck className="w-4 h-4 text-status-success-text shrink-0" />
                  <span className="font-semibold">{t("passwordSuccessChange")}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="pwd-new">{t("passwordNewHeader")}</Label>
                <div className="relative mt-1">
                  <Input
                    id="pwd-new"
                    type={showPassword ? "text" : "password"}
                    className={cn(
                      "pr-10 border-outline",
                      password && !passwordValidation.valid && "border-red-400"
                    )}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-secondary select-none cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pwd-confirm">{t("passwordConfirmHeader")}</Label>
                <Input
                  id="pwd-confirm"
                  type={showPassword ? "text" : "password"}
                  className="border-outline"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {/* Password indicator logic checklist */}
              {password && (
                <div className="mt-2 space-y-1 bg-surface-muted border border-outline p-3 rounded-lg text-[10px]">
                  <div className="flex items-center gap-1.5">
                    {password.length >= AUTH_CONFIG.PASSWORD_MIN_LENGTH && password.length <= AUTH_CONFIG.PASSWORD_MAX_LENGTH ?
                      <CheckCircle2 className="w-3 h-3 text-status-success-text shrink-0" /> : <Circle className="w-3 h-3 text-content-muted shrink-0" />}
                    <span className={password && (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH || password.length > AUTH_CONFIG.PASSWORD_MAX_LENGTH) ? "text-status-danger-text" : "text-content-muted"}>{t("passwordRuleLength", { min: AUTH_CONFIG.PASSWORD_MIN_LENGTH, max: AUTH_CONFIG.PASSWORD_MAX_LENGTH })}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/[A-Z]/.test(password) ?
                      <CheckCircle2 className="w-3 h-3 text-status-success-text shrink-0" /> : <Circle className="w-3 h-3 text-content-muted shrink-0" />}
                    <span className={password && !/[A-Z]/.test(password) ? "text-status-danger-text" : "text-content-muted"}>{t("passwordRuleUppercase")}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/[a-z]/.test(password) ?
                      <CheckCircle2 className="w-3 h-3 text-status-success-text shrink-0" /> : <Circle className="w-3 h-3 text-content-muted shrink-0" />}
                    <span className={password && !/[a-z]/.test(password) ? "text-status-danger-text" : "text-content-muted"}>{t("passwordRuleLowercase")}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/[0-9]/.test(password) ?
                      <CheckCircle2 className="w-3 h-3 text-status-success-text shrink-0" /> : <Circle className="w-3 h-3 text-content-muted shrink-0" />}
                    <span className={password && !/[0-9]/.test(password) ? "text-status-danger-text" : "text-content-muted"}>{t("passwordRuleDigit")}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {password && !/\s/.test(password) ?
                      <CheckCircle2 className="w-3 h-3 text-status-success-text shrink-0" /> : <Circle className="w-3 h-3 text-content-muted shrink-0" />}
                    <span className={password && /\s/.test(password) ? "text-status-danger-text" : "text-content-muted"}>{t("passwordRuleNoWhitespace")}</span>
                  </div>
                </div>
              )}

              <div className="pt-2">
                <Button type="submit" variant="primary" className="h-11 w-full" disabled={passwordLoading}>
                  {passwordLoading ? t("passwordResetting") : (passwordSuccess ? t("passwordResetDone") : t("passwordResetSubmit"))}
                </Button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
