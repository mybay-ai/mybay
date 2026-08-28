import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Credential } from "../../types";
import { api } from "../../lib/api";

interface UseProviderOAuthOptions {
  provider: string;
  enabled: boolean;
  onComplete: (credential: Credential, credentials: Credential[]) => void;
}

export function useProviderOAuth({ provider, enabled, onComplete }: UseProviderOAuthOptions) {
  const { t } = useTranslation("deploy");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [error, setError] = useState("");
  const popupRef = useRef<Window | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const cancel = useCallback(async (showMessage = true) => {
    cancelledRef.current = true;
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    popupRef.current = null;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) await api.post("/api/oauth/providers/cancel", { sessionId }).catch(() => undefined);
    setLoading(false);
    setSession(null);
    setError(showMessage ? t("wizardCopy.model.oauthCancelled") : "");
  }, [t]);

  const connect = useCallback(async () => {
    if (!enabled || loading) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError(t("wizardCopy.model.oauthPopupBlocked"));
      return;
    }
    try {
      popup.opener = null;
      popup.document.title = t("wizardCopy.model.oauthConnectTitle");
    } catch {}
    popupRef.current = popup;
    cancelledRef.current = false;
    sessionIdRef.current = null;
    setLoading(true);
    setError("");
    setSession(null);

    try {
      const started = await api.post("/api/oauth/providers/start", { provider });
      if (!started?.sessionId || !started?.verificationUrl) throw new Error(t("wizardCopy.model.oauthFailed"));
      sessionIdRef.current = started.sessionId;
      setSession(started);
      popup.location.replace(started.verificationUrl);

      let result: any = null;
      const deadline = Number(started.expiresAt || Date.now() + 15 * 60 * 1000);
      let pollIntervalMs = Math.max(1_000, Number(started.pollIntervalMs || 5_000));
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        if (cancelledRef.current) return;
        result = await api.post("/api/oauth/providers/poll", { sessionId: started.sessionId });
        if (result?.status === "pending") {
          pollIntervalMs = Math.max(pollIntervalMs, Number(result.pollIntervalMs || pollIntervalMs));
          continue;
        }
        if (result?.status === "complete") break;
        throw new Error(result?.error || t("wizardCopy.model.oauthFailed"));
      }
      if (!result || result.status !== "complete") throw new Error(t("wizardCopy.model.oauthTimeout"));

      const refreshed = await api.get("/api/credentials");
      const credentials: Credential[] = Array.isArray(refreshed) ? refreshed : [];
      const saved = credentials.find((credential) => credential.id === result.credentialId);
      if (!saved) throw new Error(t("wizardCopy.model.oauthCredentialMissing"));
      onCompleteRef.current(saved, credentials);
      setSession({ status: "complete" });
      cancelledRef.current = true;
      if (!popup.closed) popup.close();
    } catch (caught: any) {
      const sessionId = sessionIdRef.current;
      if (sessionId) await api.post("/api/oauth/providers/cancel", { sessionId }).catch(() => undefined);
      if (!popup.closed) popup.close();
      if (!cancelledRef.current) setError(caught?.message || t("wizardCopy.model.oauthFailed"));
    } finally {
      popupRef.current = null;
      sessionIdRef.current = null;
      setLoading(false);
    }
  }, [enabled, loading, provider, t]);

  useEffect(() => {
    setError("");
    setSession(null);
  }, [provider]);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    const sessionId = sessionIdRef.current;
    if (sessionId) void api.post("/api/oauth/providers/cancel", { sessionId }).catch(() => undefined);
  }, []);

  return { loading, session, error, connect, cancel };
}
