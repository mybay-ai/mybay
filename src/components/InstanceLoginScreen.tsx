import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Lock, User, ShieldAlert, ArrowRight, CheckCircle2, Fingerprint, RefreshCw, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorCodes, instanceBridgeReasonToErrorCode, instanceReadinessReasonToErrorCode, type ErrorCode } from "../../shared/errorCodes";
import { translateApiError, type ApiErrorPayloadLike } from "../lib/apiError";

function isHtmlErrorResponse(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("<!doctype") ||
    normalized.includes("<html") ||
    normalized.includes("cloudflare") ||
    normalized.includes("bad gateway") ||
    normalized.includes("error code 502")
  );
}

function sanitizeInstanceRedirect(rawRedirect: string): string {
  try {
    const url = new URL(rawRedirect);
    const reservedAuthPaths = ["/login", "/auth/login", "/auth/password-login"];
    if (reservedAuthPaths.includes(url.pathname)) {
      return `${url.origin}/`;
    }
    return rawRedirect;
  } catch {
    const reservedAuthPaths = ["/login", "/auth/login", "/auth/password-login"];
    if (reservedAuthPaths.includes(rawRedirect)) {
      return "/";
    }
    return rawRedirect;
  }
}

export function InstanceLoginScreen() {
  const { t } = useTranslation(["auth", "errors"]);
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("slug") || "";
  const redirect = searchParams.get("redirect") || "";
  const isBridgeMode = searchParams.get("bridge") === "1";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<"idle" | "authenticating" | "bridging" | "success" | "failed">("idle");

  const [isReadinessChecking, setIsReadinessChecking] = useState(true);
  const [readinessProgress, setReadinessProgress] = useState(() => t("instanceLogin.readinessInitial"));
  const [readinessError, setReadinessError] = useState("");
  const [readinessCanRetry, setReadinessCanRetry] = useState(false);
  const [readinessCanBypass, setReadinessCanBypass] = useState(false);
  const [readinessRetryCount, setReadinessRetryCount] = useState(0);


  const handleRetryReadiness = () => {
    setReadinessError("");
    setReadinessCanRetry(false);
    setReadinessCanBypass(false);
    setIsReadinessChecking(true);
    setReadinessProgress(t("instanceLogin.readinessInitial"));
    setReadinessRetryCount(prev => prev + 1);
  };

  const handleBypassReadiness = () => {
    setIsReadinessChecking(false);
  };


  function createLocalizedApiError(payload: ApiErrorPayloadLike, fallback: ErrorCode): Error {
    const error = new Error(translateApiError(t, payload, fallback));
    (error as Error & { apiPayload?: ApiErrorPayloadLike }).apiPayload = payload;
    return error;
  }

  function toSafeLoginErrorMessage(value: unknown): string {
    const errorWithPayload = value as { apiPayload?: ApiErrorPayloadLike } | null;
    if (errorWithPayload?.apiPayload) {
      return translateApiError(t, errorWithPayload.apiPayload, ErrorCodes.INSTANCE_LOGIN_INTERNAL_ERROR);
    }

    const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    if (isHtmlErrorResponse(text) || /failed to fetch|network error|load failed/i.test(text)) {
      return translateApiError(t, { code: ErrorCodes.INSTANCE_NETWORK_NOT_READY });
    }
    if (text.length > 300) {
      return translateApiError(t, { code: ErrorCodes.INSTANCE_LOGIN_INTERNAL_ERROR });
    }
    return text || translateApiError(t, { code: ErrorCodes.UNKNOWN });
  }

  const autoBridgeAttempted = useRef(false);
  const isRedirectingRef = useRef(false);

  const triggerRedirect = (completionUrl?: string) => {
    console.log(`[InstanceLoginScreen Diagnostics] triggerRedirect triggered:`, {
      completionUrl,
      currentStatus: status,
      currentRedirect: redirect,
      isRedirectingAlready: isRedirectingRef.current
    });

    if (isRedirectingRef.current) {
      console.warn(`[InstanceLoginScreen Diagnostics] Already in a redirecting flow. Ignoring redundant triggerRedirect call.`);
      return;
    }

    isRedirectingRef.current = true;

    // A. If completionUrl is present, must unconditionally and immediately redirect to it (skip any setTimeout delay)
    if (completionUrl) {
      console.log(`[InstanceLoginScreen Diagnostics] UNCONDITIONAL HIGH-PRIORITY REDIRECT: Redirecting immediately to completionUrl=${completionUrl}`);
      try {
        window.location.assign(completionUrl);
        return;
      } catch (err: any) {
        console.error(`[InstanceLoginScreen Diagnostics] FATAL ERROR: Failed to execute window.location.assign for completionUrl:`, err);
        return;
      }
    }

    console.log(`[InstanceLoginScreen Diagnostics] No completionUrl. Proceeding with fallback redirect in 800ms to show success UI.`);
    setTimeout(() => {
      try {
        if (redirect) {
          const sanitized = sanitizeInstanceRedirect(redirect);
          console.log(`[InstanceLoginScreen Diagnostics] Executing fallback redirect to: ${sanitized}`);
          window.location.assign(sanitized);
        } else {
          const currentHost = window.location.host;
          const isLvh = currentHost.includes("localhost") || currentHost.includes("127.0.0.1");
          let fallbackUrl = "";
          if (isLvh) {
            fallbackUrl = `http://${slug}.localhost:3000/`;
          } else {
            const baseDomain = currentHost.split(".").slice(-2).join(".");
            fallbackUrl = `${window.location.protocol}//${slug}.${baseDomain}/`;
          }
          console.log(`[InstanceLoginScreen Diagnostics] Executing default fallback redirect to: ${fallbackUrl}`);
          window.location.assign(fallbackUrl);
        }
      } catch (err: any) {
        console.error(`[InstanceLoginScreen Diagnostics] Fallback redirect failed:`, err);
      }
    }, 800);
  };

  // Poll instance readiness endpoint before allowing login or auto-bridge
  useEffect(() => {
    if (!slug) return;
    if (!isReadinessChecking) return;
    
    let active = true;
    let pollTimeout: any = null;
    let attemptCount = 0;
    const maxAttempts = 15; // 15 * 1.5s = 22.5s timeout
 
    const checkReadiness = async () => {
      if (!isReadinessChecking || !active) return;
      try {
        const res = await fetch(`/api/public/instances/readiness/${slug}`);
        if (!active) return;
 
        const data = await res.json().catch(() => ({ ready: false, reason: "invalid_response" }));
        if (data.ready) {
          setIsReadinessChecking(false);
          return;
        }
 
        const reason = data.reason || "initializing";
 
        // Check for non-recoverable errors
        const nonRecoverableReasons = [
          "basic_auth_not_enabled",
          "missing_plain_instance_password",
          "invalid_config",
        ];
        if (nonRecoverableReasons.includes(reason)) {
          setReadinessError(translateApiError(t, data, instanceReadinessReasonToErrorCode(reason)));
          setReadinessCanRetry(false);
          setReadinessCanBypass(false);
          return;
        }
 
        attemptCount++;
        if (attemptCount >= maxAttempts) {
          setReadinessError(translateApiError(t, { code: ErrorCodes.INSTANCE_AUTH_CHAIN_NOT_READY, params: { reason: "timeout" } }));
          setReadinessCanRetry(true);
          setReadinessCanBypass(true);
          return;
        }

        let progressText = reason;
        if (reason === "status_not_ok_401") {
          progressText = t("instanceLogin.progressResponded");
        } else if (reason.startsWith("status_not_ok_")) {
          progressText = t("instanceLogin.progressStatus", { status: reason.replace("status_not_ok_", "") });
        } else if (reason.startsWith("probe_failed_") || reason.startsWith("probe_returned_")) {
          progressText = t("instanceLogin.progressCredentials");
        } else if (reason === "initializing" || reason === "invalid_response") {
          progressText = t("instanceLogin.progressWaiting");
        }

        if (attemptCount > 3) {
          setReadinessProgress(t("instanceLogin.progressChecking", { progress: progressText }));
        } else {
          setReadinessProgress(t("instanceLogin.readinessInitial"));
        }

        pollTimeout = setTimeout(checkReadiness, 1500);
      } catch (err) {
        if (!active) return;
        attemptCount++;
        if (attemptCount >= maxAttempts) {
          setReadinessError(translateApiError(t, { code: ErrorCodes.INSTANCE_NETWORK_NOT_READY }));
          setReadinessCanRetry(true);
          setReadinessCanBypass(true);
          return;
        }
        pollTimeout = setTimeout(checkReadiness, 1500);
      }
    };
 
    checkReadiness();
 
    return () => {
      active = false;
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [slug, readinessRetryCount, isReadinessChecking]);

  useEffect(() => {
    if (isReadinessChecking) return; // Wait for the readiness gate to be cleared
    if (!isBridgeMode || !slug) return;
    if (autoBridgeAttempted.current) return;
    if (isRedirectingRef.current) {
      console.log("[InstanceLoginScreen Diagnostics] Auto-bridge bypassed because redirection is already active.");
      return;
    }
    
    // Check if we've already done an automatic bridge for this slug in sessionStorage
    const sessionKey = `mybay_autobridge_done_${slug}`;
    if (sessionStorage.getItem(sessionKey)) {
      console.warn("Auto-bridge already attempted and failed in this browser tab session. Stopping auto-bridge to prevent redirection loop.");
      setStatus("failed");
      setError(translateApiError(t, { code: ErrorCodes.INSTANCE_SESSION_BRIDGE_FAILED, params: { reason: "timeout" } }));
      return;
    }

    autoBridgeAttempted.current = true;
    
    const runAutoBridge = async () => {
      setStatus("bridging");
      setLoading(true);
      setError("");

      const retryDelays = [500, 1000, 1500, 2500, 3500];
      let bridgeSuccess = false;
      let fetchedCompletionUrl = "";
      let finalReason = "unknown";

      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        try {
          const res = await fetch("/api/public/instances/session-bridge", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ slug, redirect }),
          });

          const contentType = res.headers.get("content-type") || "";
          const payload = contentType.includes("application/json")
            ? await res.json()
            : { success: false, bridge: { success: false, reason: "invalid_response" } };

          console.log(`[InstanceLoginScreen Diagnostics] Auto-bridge attempt ${attempt + 1} response:`, {
            status: res.status,
            success: payload.success,
            bridgeSuccess: payload.bridge?.success,
            completionUrlExists: !!payload.bridge?.completionUrl,
            completionUrl: payload.bridge?.completionUrl
          });

          if (res.ok && payload.success && payload.bridge?.completionUrl) {
            bridgeSuccess = true;
            fetchedCompletionUrl = payload.bridge.completionUrl;
            break;
          } else if (res.ok && payload.success && payload.bridge?.success) {
            bridgeSuccess = true;
            fetchedCompletionUrl = payload.bridge?.completionUrl || "";
            break;
          } else {
            finalReason = payload.bridge?.reason || finalReason;
            if (payload.bridge?.retryable === false) {
              break;
            }
          }
        } catch (err: any) {
          console.warn(`Auto-bridge attempt ${attempt + 1} exception:`, err);
        }

        // Wait before next retry if there are more retries left
        if (attempt < retryDelays.length) {
          const delay = retryDelays[attempt];
          console.log(`Waiting ${delay}ms before auto-bridge retry ${attempt + 2}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      if (bridgeSuccess) {
        // Clear any previous session storage blocker on success
        sessionStorage.removeItem(sessionKey);
        setStatus("success");
        setSuccess(true);
        triggerRedirect(fetchedCompletionUrl);
      } else {
        // Mark as attempted & failed in sessionStorage so we don't loop infinitely
        sessionStorage.setItem(sessionKey, "1");
        setStatus("failed");
        setLoading(false);
        setError(translateApiError(t, { code: instanceBridgeReasonToErrorCode(finalReason), params: { reason: finalReason } }));
      }
    };

    runAutoBridge();
  }, [isBridgeMode, slug, isReadinessChecking]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError(translateApiError(t, { code: ErrorCodes.ACCESS_PASSWORD_REQUIRED }));
      return;
    }

    setLoading(true);
    setStatus("authenticating");
    setError("");

    try {
      let res: Response | null = null;
      let attempts = 0;
      while (attempts < 2) {
        try {
          res = await fetch("/api/public/instances/session-login", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ slug, username, password, redirect }),
          });

          const contentType = res.headers.get("content-type") || "";
          if (res.status >= 500 && attempts === 0) {
            console.warn(`First /session-login attempt failed with ${res.status}. Retrying...`);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          break;
        } catch (fetchErr: any) {
          if (attempts === 0) {
            console.warn(`First /session-login fetch exception. Retrying...`, fetchErr);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          throw fetchErr;
        }
      }

      if (!res) {
        throw createLocalizedApiError({ code: ErrorCodes.INSTANCE_NETWORK_NOT_READY }, ErrorCodes.INSTANCE_NETWORK_NOT_READY);
      }

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await res.json()
        : { error: await res.text() };

      console.log(`[InstanceLoginScreen Diagnostics] Received /session-login response:`, {
        status: res.status,
        success: payload.success,
        bridgeSuccess: payload.bridge?.success,
        completionUrlExists: !!payload.bridge?.completionUrl,
        completionUrl: payload.bridge?.completionUrl,
        bridgeRequired: payload.bridgeRequired
      });

      if (!res.ok) {
        throw createLocalizedApiError(payload, ErrorCodes.INVALID_INSTANCE_CREDENTIALS);
      }

      // A1. If completionUrl is present in successful payload, unconditionally prioritize it immediately and return!
      if (payload.success && payload.bridge?.completionUrl) {
        console.log(`[InstanceLoginScreen Diagnostics] completionUrl detected in payload. Success! Redirecting unconditionally immediately to: ${payload.bridge.completionUrl}`);
        sessionStorage.removeItem(`mybay_autobridge_done_${slug}`);
        setStatus("success");
        setSuccess(true);
        triggerRedirect(payload.bridge.completionUrl);
        return;
      }

      let runBridgeRetry = false;
      let initialBridgeReason = "network_not_ready";

      if (payload.success) {
        sessionStorage.removeItem(`mybay_autobridge_done_${slug}`);
        const isBridgeOk = payload.bridge?.success === true;
        if (isBridgeOk) {
          setStatus("success");
          setSuccess(true);
          triggerRedirect(payload.bridge?.completionUrl);
        } else if (payload.bridge?.retryable === true) {
          runBridgeRetry = true;
          initialBridgeReason = payload.bridge?.reason || "network_not_ready";
        } else {
          // Determine if bridge is not required
          const isBridgeRequired = payload.bridgeRequired === true || (payload.bridge !== undefined);
          if (!isBridgeRequired) {
            setStatus("success");
            setSuccess(true);
            triggerRedirect();
          } else {
            // Unretryable bridge failure
            setStatus("failed");
            setLoading(false);
            const reason = payload.bridge?.reason || "unknown";
            setError(translateApiError(t, payload, instanceBridgeReasonToErrorCode(reason)));
          }
        }
      } else if (payload.authorized === true && payload.bridgeFailed === true) {
        if (payload.bridge?.retryable === true) {
          runBridgeRetry = true;
          initialBridgeReason = payload.bridge?.reason || "network_not_ready";
        } else {
          setStatus("failed");
          setLoading(false);
          setError(translateApiError(t, payload, instanceBridgeReasonToErrorCode(payload.bridge?.reason || "unknown")));
          return;
        }
      } else {
        throw createLocalizedApiError(payload, ErrorCodes.INVALID_INSTANCE_CREDENTIALS);
      }

      if (runBridgeRetry) {
        setStatus("bridging");
        
        // Auto retry session-bridge up to 4 times
        const bridgeRetryDelays = [800, 1200, 1800, 2500];
        let bridgeSuccess = false;
        let fetchedCompletionUrl = "";
        let finalBridgeReason = initialBridgeReason;

        for (let r = 0; r < bridgeRetryDelays.length; r++) {
          const delay = bridgeRetryDelays[r];
          console.log(`Sleeping ${delay}ms before session-bridge retry ${r + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delay));

          try {
            const bridgeRes = await fetch("/api/public/instances/session-bridge", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ slug, redirect }),
            });

            const bContentType = bridgeRes.headers.get("content-type") || "";
            const bPayload = bContentType.includes("application/json")
              ? await bridgeRes.json()
              : { success: false, bridge: { success: false, reason: "invalid_response" } };

            console.log(`[InstanceLoginScreen Diagnostics] Manual login bridge retry ${r + 1} response:`, {
              status: bridgeRes.status,
              success: bPayload.success,
              bridgeSuccess: bPayload.bridge?.success,
              completionUrlExists: !!bPayload.bridge?.completionUrl,
              completionUrl: bPayload.bridge?.completionUrl
            });

            if (bridgeRes.ok && bPayload.success && bPayload.bridge?.completionUrl) {
              bridgeSuccess = true;
              fetchedCompletionUrl = bPayload.bridge.completionUrl;
              break;
            } else if (bridgeRes.ok && bPayload.success && bPayload.bridge?.success) {
              bridgeSuccess = true;
              fetchedCompletionUrl = bPayload.bridge?.completionUrl || "";
              break;
            } else {
              finalBridgeReason = bPayload.bridge?.reason || finalBridgeReason;
              if (bPayload.bridge?.retryable === false) {
                break;
              }
            }
          } catch (bridgeErr: any) {
            console.warn(`Session-bridge retry ${r + 1} exception:`, bridgeErr);
          }
        }

        if (bridgeSuccess) {
          setStatus("success");
          setSuccess(true);
          triggerRedirect(fetchedCompletionUrl);
        } else {
          setStatus("failed");
          setLoading(false);
          setError(translateApiError(t, { code: instanceBridgeReasonToErrorCode(finalBridgeReason), params: { reason: finalBridgeReason } }));
        }
      }
    } catch (err: any) {
      setStatus("failed");
      setLoading(false);
      setError(toSafeLoginErrorMessage(err));
    }
  };

  return (
    <div id="instance-login-wrapper" className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans antialiased text-white relative overflow-hidden">
      {/* Decorative Background Grays and Orbits */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(30,41,59,0.3),transparent_45%)]" />
      <div className="hidden sm:block absolute top-1/4 left-1/10 w-96 h-96 bg-blue-900/10 rounded-full blur-3xl" />
      <div className="hidden sm:block absolute bottom-1/4 right-1/10 w-96 h-96 bg-indigo-900/10 rounded-full blur-3xl" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-4">
          <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-2xl shadow-xl flex items-center justify-center">
            <Fingerprint id="fingerprint-avatar" className="w-9 h-9 text-blue-400 motion-safe:animate-pulse" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-semibold tracking-tight text-white mb-1">
          {t("instanceLogin.title")}
        </h2>
        <p className="text-center text-sm text-slate-400">
          {t("instanceLogin.credentialsPrompt")}
        </p>
        <div className="mt-2 flex justify-center">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-slate-900 text-blue-300 border border-slate-800 tracking-wide font-mono">
            {slug || t("instanceLogin.unknownInstance")}.localhost
          </span>
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div id="login-card-body" className="bg-slate-900/95 sm:bg-slate-900/80 sm:backdrop-blur-md py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {isReadinessChecking ? (
            <div className="text-center py-6">
              {readinessError ? (
                <>
                  <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-4 motion-safe:animate-pulse" />
                  <h3 className="text-lg font-medium text-white mb-2">{t("instanceLogin.readinessUnconfirmedTitle")}</h3>
                  <p className="text-xs text-slate-300 mb-6 text-left bg-rose-950/40 border border-rose-900/50 p-4 rounded-xl leading-relaxed whitespace-pre-wrap">{readinessError}</p>
                  
                  <div className="flex flex-col gap-3">
                    {readinessCanRetry && (
                      <button
                        type="button"
                        onClick={handleRetryReadiness}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20 cursor-pointer"
                      >
                        <RefreshCw className="w-4.5 h-4.5" />
                        {t("instanceLogin.retryReadiness")}
                      </button>
                    )}
                    {readinessCanBypass && (
                      <button
                        type="button"
                        onClick={handleBypassReadiness}
                        className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer"
                      >
                        <ArrowRight className="w-4.5 h-4.5" />
                        {t("instanceLogin.continueWithoutCheck")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.location.assign("/console/instances")}
                      className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700 cursor-pointer"
                    >
                      {t("instanceLogin.backToConsole")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-white mb-2">{t("instanceLogin.preparingAuthChain")}</h3>
                  <p className="text-sm text-slate-400 motion-safe:animate-pulse">{readinessProgress}</p>
                </>
              )}
            </div>
          ) : status === "success" ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4 motion-safe:animate-bounce" />
              <h3 className="text-lg font-medium text-white mb-2">{t("instanceLogin.accessGranted")}</h3>
              <p className="text-sm text-slate-400 motion-safe:animate-pulse">{t("instanceLogin.enteringInstance")}</p>
            </div>
          ) : status === "bridging" ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-16 h-16 text-blue-400 mx-auto mb-4 motion-safe:animate-pulse" />
              <h3 className="text-lg font-medium text-white mb-2">{t("instanceLogin.accessPassed")}</h3>
              <p className="text-sm text-slate-400 motion-safe:animate-pulse">{t("instanceLogin.syncingSession")}</p>
            </div>
          ) : isBridgeMode && status === "failed" ? (
            <div className="space-y-6 text-center py-4">
              <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4 motion-safe:animate-bounce" />
              <h3 className="text-lg font-medium text-white">{t("instanceLogin.sessionSyncFailed")}</h3>
              <p className="text-sm text-slate-400">{error || t("instanceLogin.sessionSyncFailedFallback")}</p>
              <div className="pt-4 flex flex-col gap-3">
                <button
                  onClick={() => {
                    sessionStorage.removeItem(`mybay_autobridge_done_${slug}`);
                    window.location.reload();
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg transition cursor-pointer"
                >
                  {t("instanceLogin.retrySessionSync")}
                </button>
                <button
                  onClick={() => {
                    const params = new URLSearchParams(window.location.search);
                    params.delete("bridge");
                    params.delete("reason");
                    window.location.search = params.toString();
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition cursor-pointer"
                >
                  {t("instanceLogin.manualPasswordLogin")}
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit} autoComplete="off">
              {/* Hidden autofill traps to absorb credentials manager auto-fill before real inputs */}
              <input
                type="text"
                name="fake-username-trap"
                autoComplete="username"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', top: '-1000px', left: '-1000px', width: '1px', height: '1px', opacity: 0.01, overflow: 'hidden' }}
              />
              <input
                type="password"
                name="fake-password-trap"
                autoComplete="new-password"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', top: '-1000px', left: '-1000px', width: '1px', height: '1px', opacity: 0.01, overflow: 'hidden' }}
              />

              {error && (
                <div className="rounded-xl bg-red-950/40 border border-red-900/50 p-4 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-200">{error}</div>
                </div>
              )}

              <div>
                <label htmlFor={`mybay-instance-access-username-${slug}`} className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  {t("instanceLogin.accessUsernameLabel")}
                </label>
                <div className="relative rounded-xl shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-4.5 flex items-center pointer-events-none">
                    <User className="h-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id={`mybay-instance-access-username-${slug}`}
                    name={`mybay-instance-access-username-${slug}`}
                    type="text"
                    required
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="block w-full pl-12 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-white placeholder-slate-600 transition"
                    placeholder={t("instanceLogin.accessUsernamePlaceholder")}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={`mybay-instance-access-password-${slug}`} className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  {t("instanceLogin.accessPasswordLabel")}
                </label>
                <div className="relative rounded-xl shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-4.5 flex items-center pointer-events-none">
                    <Lock className="h-5 h-5 text-slate-500" />
                  </div>
                  <input
                    id={`mybay-instance-access-password-${slug}`}
                    name={`mybay-instance-access-password-${slug}`}
                    type="password"
                    required
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-12 pr-4 py-3 bg-slate-950 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-white placeholder-slate-600 transition"
                    placeholder={t("instanceLogin.accessPasswordPlaceholder")}
                  />
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold shadow-lg hover:shadow-blue-500/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {((status as string) === "authenticating") ? t("instanceLogin.verifyingCredentials") : ((status as string) === "bridging") ? t("instanceLogin.syncingSession") : t("instanceLogin.authorizeAndEnter")}
                  <ArrowRight className="w-4.5 h-4.5" />
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-8 text-center text-xs text-slate-600">
          <p>© {new Date().getFullYear()} {t("instanceLogin.footer")}</p>
        </div>
      </div>
    </div>
  );
}
