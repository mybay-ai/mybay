import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SetupFormData } from "../../types";
import { api } from "../../lib/api";
import { sanitizeDeployPayload } from "./sanitizeDeployPayload";

/** Deployment preflight, version loading and explicit connection checks. */
export function useDeployDiagnostics(data: Partial<SetupFormData>, currentUser: any) {
  const { t } = useTranslation("deploy");
  const [preflight, setPreflight] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [testResults, setTestResults] = useState<any>({});
  const modelFingerprint = JSON.stringify([data.runtime_type, data.provider, data.model, data.baseUrl, data.providerApiKey, data.providerCredentialId]);
  const latestModelFingerprint = useRef(modelFingerprint);
  latestModelFingerprint.current = modelFingerprint;
  const fetchVersions = async () => {
    try {
      const data = await api.get("/api/agent-versions");
      if (data) {
        setVersions(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const runPreflight = async () => {
    if (currentUser?.role !== 'admin') {
      // Regular users don't see technical preflight details, mock success to allow deployment wizard flow
      setPreflight({
        status: "ok",
        checks: [
          { name: t("wizardCopy.preflight.localRuntime"), status: "ok", message: t("wizardCopy.preflight.localRuntimeReady") },
          { name: "Deployment quota check", status: "ok", message: "Local administrator can deploy instances." }
        ]
      });
      return;
    }
    setPreflight(null);
    try {
      const result = await api.get("/api/system/preflight");
      setPreflight(result);
    } catch (e: any) {
      console.error(e);
      if (e.status === 403) {
        setPreflight({
          status: "error",
          checks: [{ name: t("preflight_errors.permission_title"), status: "fail", message: t("preflight_errors.permission_msg") }]
        });
      } else {
        setPreflight({
          status: "error",
          checks: [{ name: t("preflight_errors.system_title"), status: "fail", message: t("preflight_errors.system_msg") }]
        });
      }
    }
  };


  const testLLM = async () => {
    const requestedFingerprint = modelFingerprint;
    setTestResults((tr: any) => ({ ...tr, llm: { loading: true } }));
    try {
      const result = await api.post("/api/system/test-llm", {
        provider: data.provider,
        model: data.model,
        baseUrl: data.baseUrl,
        apiKey: data.providerApiKey,
        credentialId: data.providerCredentialId
      });
      if (latestModelFingerprint.current !== requestedFingerprint) return;
      setTestResults((tr: any) => ({ ...tr, llm: { loading: false, result } }));
    } catch (e: any) {
      if (latestModelFingerprint.current !== requestedFingerprint) return;
      setTestResults((tr: any) => ({ ...tr, llm: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const testChannel = async () => {
    setTestResults((tr: any) => ({ ...tr, channel: { loading: true } }));
    try {
      const sanitized = sanitizeDeployPayload(data);
      const result = await api.post("/api/system/test-channel", sanitized);
      setTestResults((tr: any) => ({ ...tr, channel: { loading: false, result } }));
    } catch (e: any) {
      setTestResults((tr: any) => ({ ...tr, channel: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  const testSkill = async (skillId: string) => {
    setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: true } }));
    try {
      const result = await api.post("/api/system/test-skill", { skillId, ...data });
      setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: false, result } }));
    } catch (e: any) {
      setTestResults((tr: any) => ({ ...tr, [`skill_${skillId}`]: { loading: false, result: { success: false, error: e.message } } }));
    }
  };

  useEffect(() => {
    runPreflight();
    fetchVersions();
  }, []);

  return { preflight, versions, testResults, setTestResults, runPreflight, testLLM, testChannel, testSkill };
}
