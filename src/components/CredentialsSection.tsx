import React, { useState, useEffect } from "react";
import { Key, Plus, Trash2, Edit2, ShieldAlert, Check, X, Search, Filter, ExternalLink, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { Button, Card, cn } from "./ui";
import { motion, AnimatePresence } from "motion/react";
import { useFeedback } from "./FeedbackProvider";
import { getProviderDisplayGroups } from "../../shared/providerRegistryUtils";
import type { Credential } from "../types";

import { api } from "../lib/api";
import { useTranslation } from "react-i18next";
import { ErrorCodes, type ErrorCode } from "../../shared/errorCodes";
import { extractApiErrorPayload, translateApiError } from "../lib/apiError";

export function CredentialsSection({ currentUser }: { currentUser: any }) {
  const { showToast, showAlert, showConfirm } = useFeedback();
  const { t, i18n } = useTranslation(["dashboard", "errors", "common"]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const dateFormatter = new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language);
  const formatCredentialDate = (value: string | Date) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : dateFormatter.format(date);
  };
  const localizeCredentialError = (value: unknown, fallback: ErrorCode) =>
    translateApiError(t, extractApiErrorPayload(value), fallback);

  const [formData, setFormData] = useState({
    name: "",
    type: "openai",
    key: "",
    baseUrl: "",
    isCustom: false
  });
  const providerGroups = getProviderDisplayGroups();

  const fetchCredentials = async () => {
    try {
      const data = await api.get("/api/credentials");
      if (data) {
        setCredentials(data);
      }
    } catch (err) {
      console.error("Failed to fetch credentials:", err);
      showAlert({
        title: t("credentials.loadFailedTitle"),
        message: localizeCredentialError(err, ErrorCodes.CREDENTIALS_LOAD_FAILED),
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleSave = async () => {
    if (!formData.name || !formData.key) {
      showAlert({
        title: t("credentials.saveFailedTitle"),
        message: translateApiError(t, { code: ErrorCodes.CREDENTIAL_FIELDS_REQUIRED }),
        type: "error",
      });
      return;
    }
    
    setIsSaving(true);
    try {
      const url = editingId ? `/api/credentials/${editingId}` : "/api/credentials";
      
      const payload = { ...formData };
      if (editingId && payload.key === "••••••••••••••••") {
        delete (payload as any).key; // Don't overwrite with dots
      }

      const data = editingId 
        ? await api.patch(url, payload)
        : await api.post(url, payload);

      if (data) {
        setIsAdding(false);
        setEditingId(null);
        setFormData({ name: "", type: "openai", key: "", baseUrl: "", isCustom: false });
        fetchCredentials();
        showToast(t("credentials.saved"), "success");
      } else {
        showAlert({
          title: t("credentials.saveFailedTitle"),
          message: translateApiError(t, {
            code: editingId ? ErrorCodes.CREDENTIAL_UPDATE_FAILED : ErrorCodes.CREDENTIAL_CREATE_FAILED,
          }),
          type: "error",
        });
      }
    } catch (err: any) {
      console.error("Failed to save credential:", err);
      showAlert({
        title: t("credentials.saveFailedTitle"),
        message: localizeCredentialError(
          err,
          editingId ? ErrorCodes.CREDENTIAL_UPDATE_FAILED : ErrorCodes.CREDENTIAL_CREATE_FAILED,
        ),
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (credential: Credential) => {
    if (credential.type === "custom") {
      showAlert({
        title: t("credentials.modelRequiredTitle"),
        message: t("credentials.modelRequiredMessage"),
        type: "info",
      });
      return;
    }

    setTestingId(credential.id);
    try {
      const result = await api.post("/api/system/test-llm", {
        provider: credential.type,
        credentialId: credential.id,
        baseUrl: credential.baseUrl,
      });
      if (!result?.success) throw new Error(result?.error || t("credentials.testFailedMessage"));
      await fetchCredentials();
      showToast(t("credentials.testSucceeded"), "success");
    } catch (error: any) {
      showAlert({
        title: t("credentials.testFailedTitle"),
        message: error?.message || t("credentials.testFailedMessage"),
        type: "error",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirm({
      title: t("credentials.deleteConfirmTitle"),
      message: t("credentials.deleteConfirmMessage"),
      type: "danger",
      confirmText: t("credentials.confirmDelete"),
      cancelText: t("credentials.cancel"),
    });
    if (!confirmed) return;

    try {
      await api.delete(`/api/credentials/${id}`);
      fetchCredentials();
      showToast(t("credentials.deleted"), "success");
    } catch (err: any) {
      console.error("Failed to delete credential:", err);
      showAlert({
        title: t("credentials.deleteFailedTitle"),
        message: localizeCredentialError(err, ErrorCodes.CREDENTIAL_DELETE_FAILED),
        type: "error",
      });
    }
  };

  const startEdit = (cred: Credential) => {
    setEditingId(cred.id);
    setFormData({
      name: cred.name,
      type: cred.type,
      key: "••••••••••••••••", // Masked placeholder
      baseUrl: cred.baseUrl || "",
      isCustom: cred.isCustom || false
    });
    setIsAdding(true);
  };

  const getSecureKeyLabel = (keyVal: any) => {
    if (!keyVal) return t("credentials.keyNotSet");
    const str = String(keyVal).trim();
    const lower = str.toLowerCase();
    if (
      lower.includes("sk-") ||
      lower.includes("sk" + "-proj-") ||
      lower.includes("sk" + "-cp-") ||
      lower.includes("bearer") ||
      lower.includes("api_key") ||
      lower.includes("token") ||
      lower.includes("secret")
    ) {
      return "[REDACTED]";
    }
    return t("credentials.keySaved");
  };

  const filtered = credentials.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-content">{t("credentials.title")}</h2>
          <p className="text-sm text-content-muted">{t("credentials.description")}</p>
        </div>
        <Button 
          onClick={() => {
            setEditingId(null);
            setFormData({ name: "", type: "openai", key: "", baseUrl: "", isCustom: false });
            setIsAdding(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-bold gap-2 cursor-pointer shadow-md shadow-blue-500/10 hover:shadow-blue-500/20"
        >
          <Plus className="w-4 h-4" />
          {t("credentials.addCredential")}
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-muted" />
          <input 
            type="text"
            placeholder={t("credentials.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-outline rounded-lg text-sm text-content placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 dark:focus:ring-emerald-500/15 focus:border-slate-400 dark:focus:border-slate-700 transition-all"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {isAdding && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="lg:col-span-1"
            >
              <Card className="p-6 border-blue-200 dark:border-blue-900/40 bg-blue-50/30 dark:bg-blue-950/20">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2 font-bold text-blue-900 dark:text-blue-300">
                    <Key className="w-4 h-4" />
                    {editingId ? t("credentials.editCredential") : t("credentials.addCredential")}
                  </div>
                  <button aria-label={t("credentials.closeForm")} onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">{t("credentials.nameLabel")}</label>
                    <input 
                      type="text"
                      placeholder={t("credentials.namePlaceholder")}
                      className="w-full px-3 py-2 bg-surface border border-outline rounded-lg text-sm text-content placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-slate-400 dark:focus:border-slate-700 transition-all"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>

                   <div className="space-y-1.5">
                    <label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">{t("credentials.typeLabel")}</label>
                    <select 
                      className="w-full px-3 py-2 border border-outline rounded-lg text-sm bg-surface text-content focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-slate-400 dark:focus:border-slate-700 transition-all cursor-pointer"
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value})}
                    >
                      {providerGroups.map((group) => (
                        <optgroup key={group.id} label={t(`common:providerPicker.groups.${group.id}`)} className="bg-surface text-content">
                          {group.providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.label}</option>
                          ))}
                        </optgroup>
                      ))}
                      <optgroup label={t("credentials.searchProviders")} className="bg-surface text-content">
                        <option value="tavily">{t("credentials.providerTavily")}</option>
                        <option value="serper">{t("credentials.providerSerper")}</option>
                      </optgroup>
                      <optgroup label={t("credentials.otherProviders")} className="bg-surface text-content">
                        <option value="custom">{t("credentials.customProvider")}</option>
                      </optgroup>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">{t("credentials.apiKeyLabel")}</label>
                    <div className="relative">
                      <input 
                        type={showKey ? "text" : "password"}
                        placeholder={t("credentials.apiKeyPlaceholder")}
                        className="w-full px-3 py-2 pr-10 bg-surface border border-outline rounded-lg text-sm font-mono text-content placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-slate-400 dark:focus:border-slate-700 transition-all"
                        value={formData.key}
                        onChange={(e) => setFormData({...formData, key: e.target.value})}
                      />
                      <button 
                        type="button"
                        aria-label={t(showKey ? "credentials.hideApiKey" : "credentials.showApiKey")}
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-pointer"
                      >
                        {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {formData.type === 'custom' && (
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-bold text-content-secondary uppercase tracking-wider">{t("credentials.baseUrlLabel")}</label>
                      <input 
                        type="text"
                        placeholder="https://api.your-provider.com/v1"
                        className="w-full px-3 py-2 bg-surface border border-outline rounded-lg text-sm text-content placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-slate-400 dark:focus:border-slate-700 transition-all"
                        value={formData.baseUrl}
                        onChange={(e) => setFormData({...formData, baseUrl: e.target.value})}
                      />
                    </div>
                  )}

                  <div className="pt-4 flex gap-3">
                    <Button 
                      onClick={handleSave}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-bold cursor-pointer"
                      disabled={!formData.name || !formData.key || isSaving}
                    >
                      {isSaving ? t("credentials.saving") : t("credentials.save")}
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => setIsAdding(false)}
                      className="flex-1 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 cursor-pointer"
                      disabled={isSaving}
                    >
                      {t("credentials.cancel")}
                    </Button>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {filtered.map((cred) => (
            <motion.div
              key={cred.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <Card className="p-5 bg-surface border border-outline/80 hover:border-blue-200 dark:hover:border-blue-800/80 hover:shadow-md transition-all group overflow-hidden relative">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-control-hover rounded-xl text-content-secondary group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40 group-hover:text-blue-600 dark:group-hover:text-blue-300 transition-colors">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-slate-200">{cred.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                         <span className="text-[11px] px-1.5 py-0.5 bg-control-hover text-content-muted rounded uppercase font-bold">{cred.type}</span>
                         <span className="text-[11px] text-content-muted">{formatCredentialDate(cred.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <button 
                      aria-label={t("credentials.editNamedCredential", { name: cred.name })}
                      onClick={() => startEdit(cred)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg cursor-pointer transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      aria-label={t("credentials.deleteNamedCredential", { name: cred.name })}
                      onClick={() => handleDelete(cred.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-2.5 bg-surface-muted rounded-lg border border-outline/80">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-[13px] font-mono text-content-muted line-clamp-1">
                        {getSecureKeyLabel(cred.key || cred.secretLabel)}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-xs"
                    disabled={testingId === cred.id}
                    onClick={() => void handleTest(cred)}
                  >
                    {testingId === cred.id
                      ? t("credentials.testing")
                      : cred.verificationStatus === "verified"
                        ? t("credentials.retestVerified")
                        : t("credentials.testConnection")}
                  </Button>
                  {cred.baseUrl && (
                    <div className="text-[11px] text-content-muted truncate flex items-center gap-1.5 px-1">
                      <ExternalLink className="w-3 h-3" />
                      {cred.baseUrl}
                    </div>
                  )}
                </div>

                <div className="absolute bottom-0 right-0 p-4 opacity-5 dark:opacity-[0.02] pointer-events-none grayscale">
                   <Key className="w-16 h-16 rotate-12 text-content-muted" />
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>

        {!loading && filtered.length === 0 && !isAdding && (
          <div className="col-span-full py-20 text-center">
            <div className="w-16 h-16 bg-control-hover rounded-full flex items-center justify-center mx-auto mb-4 text-content-muted">
              <Key className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-content">{t("credentials.emptyTitle")}</h3>
            <p className="text-content-muted max-w-sm mx-auto mt-2 mb-6 text-sm">{t("credentials.emptyDescription")}</p>
            <Button 
              onClick={() => setIsAdding(true)}
              variant="outline"
              className="gap-2 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t("credentials.addNow")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
