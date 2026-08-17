import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AUTH_CONFIG, validatePassword, validateUsername } from "../../../shared/authValidation";
import { setStoredUser } from "../../lib/auth";
import { api } from "../../lib/api";
import { BrandLogo } from "../BrandLogo";
import { LanguageToggle } from "../LanguageToggle";
import { Button, Card, cn, Input, Label } from "../ui";
import { Turnstile } from "./Turnstile";

export function AuthScreen({ onLogin }: { onLogin: (user: any) => void }) {
  const { t } = useTranslation("auth");
  const location = useLocation();
  const navigate = useNavigate();

  // Replace useState for isLogin with a derived value from the pathname
  const isLogin = location.pathname !== "/register";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [postLoginNavigating, setPostLoginNavigating] = useState(false);
  const [config, setConfig] = useState<{
    captchaEnabled?: boolean,
    turnstileSiteKey?: string
  } | null>(null);
  const [view, setView] = useState<'login' | 'register' | 'forgot'>('login');
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaRetryKey, setCaptchaRetryKey] = useState(0);

  useEffect(() => {
    if (location.pathname === "/register") setView('register');
    else setView('login');
  }, [location.pathname]);

  useEffect(() => {
    api.get("/api/auth/config")
      .then(data => setConfig(data))
      .catch(err => {
        console.error("Failed to fetch auth config", err);
        // Fallback to safe defaults if config fails to load
        setConfig({ captchaEnabled: false });
      });
  }, []);

  const usernameValidation = !isLogin && view === 'register' ? validateUsername(username) : { valid: true };
  const passwordValidation = !isLogin && view === 'register' ? validatePassword(password, username) : { valid: true };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (view === 'register') {
      if (!usernameValidation.valid) {
        setError(usernameValidation.message || t("validationErrorUsername"));
        return;
      }
      if (!passwordValidation.valid) {
        setError(passwordValidation.message || t("validationErrorPassword"));
        return;
      }
    }

    // Safety check: if captcha is required but failed to load or key is missing
    if ((view === 'login' && requiresCaptcha) || (view === 'register' && config?.captchaEnabled)) {
      if (!config?.turnstileSiteKey) {
        setError(t("safetyWarningNoSiteKey"));
        return;
      }
      if (captchaError) {
        setError(t("captchaLoadFailed", { error: captchaError }));
        return;
      }
      if (!captchaToken) {
        setError(t("pleaseCompleteCaptcha"));
        return;
      }
    }

    let succeeded = false;
    setLoading(true);

    try {
      const endpoint = "/api/auth/login";

      const payload: any = { username: username.trim(), password };

      if ((view === 'login' || view === 'register') && captchaToken) {
        payload.captchaToken = captchaToken;
      }

      const data = await api.post(endpoint, payload);

      if (data) {
        if (view === 'forgot') {
          setSuccessMsg(t("forgotSuccessMsg"));
          succeeded = true;
          setLoading(false);
          return;
        }

        const userObj = {
          id: data.id,
          username: data.username,
          avatar_url: data.avatar_url,
          role: data.role,
        };
        setStoredUser(userObj);
        setPostLoginNavigating(true);
        onLogin(userObj);
        succeeded = true;

        navigate("/app");
      } else {
        const isCaptchaActive = (view === 'login' && requiresCaptcha) || (view === 'register' && config?.captchaEnabled);
        if (isCaptchaActive) {
          setCaptchaToken("");
          setCaptchaRetryKey(prev => prev + 1);
        }
        setError(t("authFailedReset"));
      }
    } catch (e: any) {
      const isCaptchaActiveNow = (view === 'login' && (requiresCaptcha || e.data?.requiresCaptcha)) || (view === 'register' && config?.captchaEnabled);
      if (isCaptchaActiveNow) {
        setCaptchaToken("");
        setCaptchaRetryKey(prev => prev + 1);
      }

      if (e.data?.requiresCaptcha) {
        setRequiresCaptcha(true);
        setError(e.data.error || t("pleaseCompleteCaptcha"));
        return;
      }

      let errorMsg = e.status === 401
        ? t("invalidCredentials")
        : e.data?.error || t("genericError");
      if (isCaptchaActiveNow) {
        if (e.data?.code === "CAPTCHA_FAILED") {
          errorMsg = t("captchaFailedMessage");
        } else {
          errorMsg = `${errorMsg}${t("captchaFailedExpired")}`;
        }
      }
      setError(errorMsg);
    } finally {
      if (!succeeded) {
        setLoading(false);
      }
    }
  };

  // Derived state to check if the form is submittable
  const isSubmitDisabled = loading || postLoginNavigating ||
    (requiresCaptcha && (!captchaToken || !!captchaError || !config?.turnstileSiteKey)) ||
    (view === 'register' && config?.captchaEnabled && (!captchaToken || !!captchaError || !config?.turnstileSiteKey));

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center bg-surface-muted text-content px-4 pt-32 pb-16 transition-colors duration-200">
      <div className="pointer-events-none absolute inset-x-0 top-20 mx-auto h-[360px] max-w-3xl rounded-full bg-blue-200/35 dark:bg-blue-600/10 blur-3xl" />
      <div className="relative z-10 w-full max-w-md my-auto">
        <div className="flex flex-col items-center mb-10">
          <BrandLogo size="lg" textColor="text-slate-900" invertOnDark className="mb-2" />
          <p className="text-content-muted mt-2 text-center text-sm font-medium">
            {t("subtitle")}
          </p>
        </div>

        <Card className="p-8 border-outline bg-surface shadow-xl shadow-slate-200/50 dark:shadow-black/30">
          <h2 className="text-xl font-semibold mb-6">
            {view === 'login' ? t("loginTitle") : view === 'register' ? t("registerTitle") : t("forgotTitle")}
          </h2>

          {error && (
            <div className="p-3 mb-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-200 rounded-md text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {requiresCaptcha && !config?.turnstileSiteKey && (
            <div className="p-3 mb-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/70 text-red-600 dark:text-red-200 rounded-md text-sm flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="flex flex-col">
                <span className="font-bold">{t("securityConfigWarning")}</span>
                <span>{t("securityConfigWarningDetail")}</span>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="p-3 mb-6 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 text-emerald-600 dark:text-emerald-200 rounded-md text-sm flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {config === null ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-content-muted font-medium tracking-wide animate-pulse">{t("initSecurityConfig")}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {view !== 'forgot' && (
                <div>
                  <Label>{t("usernameLabel")}</Label>
                  <Input
                    className={cn(
                       "mt-1 font-sans",
                      !isLogin && username && !usernameValidation.valid && "border-red-400 focus-visible:ring-red-400"
                    )}
                    placeholder={t("usernamePlaceholder")}
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                  />
                  {view === 'register' && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium transition-colors">
                        {username.length >= AUTH_CONFIG.USERNAME_MIN_LENGTH && username.length <= AUTH_CONFIG.USERNAME_MAX_LENGTH ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={username && (username.length < AUTH_CONFIG.USERNAME_MIN_LENGTH || username.length > AUTH_CONFIG.USERNAME_MAX_LENGTH) ? "text-red-500" : "text-content-muted"}>
                          {t("usernameRuleLength", { min: AUTH_CONFIG.USERNAME_MIN_LENGTH, max: AUTH_CONFIG.USERNAME_MAX_LENGTH })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {/^[A-Za-z]/.test(username) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={username && !/^[A-Za-z]/.test(username) ? "text-red-500" : "text-content-muted"}>
                          {t("usernameRuleLetterStart")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {/^[A-Za-z0-9_]+$/.test(username) && !username.endsWith('_') && !/__+/.test(username) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={username && (!/^[A-Za-z0-9_]+$/.test(username) || username.endsWith('_') || /__+/.test(username)) ? "text-red-500" : "text-content-muted"}>
                          {t("usernameRuleChars")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {view !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password-input">{t("passwordLabel")}</Label>
                  </div>
                  <div className="relative mt-1">
                    <Input
                      id="password-input"
                      type={showPassword ? "text" : "password"}
                      className={cn(
                        "pr-10",
                        !isLogin && password && !passwordValidation.valid && "border-red-400 focus-visible:ring-red-400"
                      )}
                      placeholder={t("passwordPlaceholder")}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content-secondary"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {view === 'register' && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {password.length >= AUTH_CONFIG.PASSWORD_MIN_LENGTH && password.length <= AUTH_CONFIG.PASSWORD_MAX_LENGTH ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={password && (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH || password.length > AUTH_CONFIG.PASSWORD_MAX_LENGTH) ? "text-red-500" : "text-content-muted"}>
                          {t("passwordRuleLength", { min: AUTH_CONFIG.PASSWORD_MIN_LENGTH, max: AUTH_CONFIG.PASSWORD_MAX_LENGTH })}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {/[A-Z]/.test(password) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={password && !/[A-Z]/.test(password) ? "text-red-500" : "text-content-muted"}>
                          {t("passwordRuleUppercase")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {/[a-z]/.test(password) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={password && !/[a-z]/.test(password) ? "text-red-500" : "text-content-muted"}>
                          {t("passwordRuleLowercase")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {/[0-9]/.test(password) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={password && !/[0-9]/.test(password) ? "text-red-500" : "text-content-muted"}>
                          {t("passwordRuleDigit")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {password && !/\s/.test(password) ?
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                          <Circle className="w-3 h-3 text-content-muted" />
                        }
                        <span className={password && /\s/.test(password) ? "text-red-500" : "text-content-muted"}>
                          {t("passwordRuleNoWhitespace")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {((view === 'login' && requiresCaptcha) || (view === 'register' && config?.captchaEnabled)) && config?.turnstileSiteKey && (
                <div className="space-y-2 mt-4">
                  <Turnstile
                    key={captchaRetryKey}
                    siteKey={config.turnstileSiteKey}
                    onSuccess={(token) => {
                      setCaptchaToken(token);
                      setCaptchaError("");
                    }}
                    onError={(err) => setCaptchaError(err)}
                  />
                  {captchaError && (
                    <div className="text-[11px] text-red-500 font-medium flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {captchaError}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCaptchaRetryKey(prev => prev + 1);
                          setCaptchaError("");
                          setCaptchaToken("");
                        }}
                        className="text-blue-600 hover:underline text-left pl-4"
                      >
                        {t("captchaRetry")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <Button
                className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold h-11"
                disabled={isSubmitDisabled}
              >
                {postLoginNavigating ? "正在进入控制台..." : (loading ? (view === 'login' ? "正在登录..." : t("loadingText")) : (view === 'login' ? t("btn_login") : view === 'register' ? t("btn_register") : t("btn_sendReset")))}
              </Button>

              {(view === 'login' || view === 'register') && (
                <p className="mt-4 text-xs text-center text-content-muted leading-relaxed font-sans" id="legal-disclaimer">
                  {view === 'login' ? t("legal_login_prefix") : t("legal_register_prefix")}{" "}
                  <Link
                    to="/terms"
                    className="text-blue-600 dark:text-blue-300 hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded px-0.5"
                    id="terms-link"
                  >
                    {t("terms_of_service")}
                  </Link>{" "}
                  {t("legal_and")}{" "}
                  <Link
                    to="/privacy"
                    className="text-blue-600 dark:text-blue-300 hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded px-0.5"
                    id="privacy-link"
                  >
                    {t("privacy_policy")}
                  </Link>
                  {t("legal_period")}
                </p>
              )}
            </form>
          )}

          <div className="mt-6 flex flex-col items-center gap-3 text-sm">
            {false && view !== 'forgot' && (
              <div className="flex items-center gap-1">
                <span className="text-content-secondary">
                  {view === 'login' ? t("noAccount") : t("hasAccount")}
                </span>
                <button
                  type="button"
                  className="text-blue-600 font-medium hover:underline"
                  onClick={() => {
                    const nextView = view === 'login' ? 'register' : 'login';
                    setView(nextView);
                    setError("");
                    setSuccessMsg("");
                    navigate(nextView === 'register' ? '/register' : '/login');
                  }}
                >
                  {view === 'login' ? t("registerNow") : t("backToLogin")}
                </button>
              </div>
            )}

            {view === 'forgot' && (
              <button
                type="button"
                className="text-blue-600 font-medium hover:underline"
                onClick={() => setView('login')}
              >
                {t("backToLogin")}
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
