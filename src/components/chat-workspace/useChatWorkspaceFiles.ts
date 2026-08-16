import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { createPreviewRequestGuard, isPreviewAbortError, type PreviewRequestToken } from "./previewRequestGuard";
import { type PendingAttachment } from "./ChatInputBar";
import {
  DEFAULT_CHAT_ATTACHMENT_CONFIG,
  DIRECT_CHAT_ATTACHMENT_EXTENSIONS,
  isChatAttachmentLimitReached,
  remainingChatAttachmentSlots,
  type ChatAttachmentConfig
} from "../../../shared/chatAttachmentContract";

type ShowToast = (message: string, type?: "success" | "info" | "warning" | "error", duration?: number) => void;

export type ConversationFilePreview = {
  file: PendingAttachment;
  kind: "image" | "html" | "pdf" | "markdown" | "text" | "office" | "unsupported";
  source?: "conversation" | "instance";
  instancePath?: string;
  loading?: boolean;
  url?: string;
  text?: string;
  error?: string;
};

type UseChatWorkspaceFilesOptions = {
  selectedId: string;
  selectedConversationId: string | null;
  isChatReady: boolean;
  chatMode: "quick" | "assist" | "agent";
  showToast: ShowToast;
};

const dedupeConversationFiles = (files: PendingAttachment[]) => {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (!file?.id || seen.has(file.id)) return false;
    seen.add(file.id);
    return true;
  });
};

export function useChatWorkspaceFiles({
  selectedId,
  selectedConversationId,
  isChatReady,
  chatMode,
  showToast
}: UseChatWorkspaceFilesOptions) {
  const { t } = useTranslation(["dashboard", "common"]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentConfig, setAttachmentConfig] = useState<ChatAttachmentConfig>(DEFAULT_CHAT_ATTACHMENT_CONFIG);
  const [conversationFiles, setConversationFiles] = useState<PendingAttachment[]>([]);
  const [conversationFilePreview, setConversationFilePreview] = useState<ConversationFilePreview | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const selectedIdRef = useRef(selectedId);
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const conversationFilePreviewUrlRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const previewRequestGuardRef = useRef(createPreviewRequestGuard());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    let cancelled = false;
    void api.getChatAttachmentConfig()
      .then((response) => {
        if (!cancelled && response?.config) setAttachmentConfig(response.config);
      })
      .catch((error) => console.warn("Failed to load chat attachment configuration:", error));
    return () => { cancelled = true; };
  }, []);

  const invalidatePreviewRequests = useCallback(() => {
    previewRequestGuardRef.current.invalidate();
  }, []);

  const beginPreviewRequest = useCallback((identity: string) => (
    previewRequestGuardRef.current.begin({
      instanceId: selectedIdRef.current,
      conversationId: selectedConversationIdRef.current,
      identity
    })
  ), []);

  const isPreviewRequestCurrent = useCallback((request: PreviewRequestToken) => (
    previewRequestGuardRef.current.isCurrent(request, {
      instanceId: selectedIdRef.current,
      conversationId: selectedConversationIdRef.current
    })
  ), []);

  const resetDragState = useCallback(() => {
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
  }, []);

  const clearConversationFilePreview = useCallback(() => {
    invalidatePreviewRequests();
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }
    setConversationFilePreview(null);
  }, [invalidatePreviewRequests]);

  const refreshConversationFiles = useCallback(async (instanceId: string, conversationId: string | null) => {
    if (!instanceId || !conversationId) {
      setConversationFiles([]);
      return;
    }

    try {
      const res = await api.listChatFiles(instanceId, conversationId);
      if (
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === conversationId
      ) {
        setConversationFiles(dedupeConversationFiles(Array.isArray(res?.files) ? res.files : []));
      }
    } catch (err) {
      console.warn("Failed to refresh conversation files:", err);
      if (
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === conversationId
      ) {
        setConversationFiles([]);
      }
    }
  }, []);

  useEffect(() => {
    return () => clearConversationFilePreview();
  }, [clearConversationFilePreview]);

  useEffect(() => {
    clearConversationFilePreview();
    setPendingAttachments([]);
    setConversationFiles([]);
    void refreshConversationFiles(selectedId, selectedConversationId);
  }, [selectedId, selectedConversationId, clearConversationFilePreview, refreshConversationFiles]);

  useEffect(() => {
    resetDragState();
  }, [selectedId, selectedConversationId, resetDragState]);

  useEffect(() => {
    const handleWindowReset = () => {
      resetDragState();
    };
    window.addEventListener("blur", handleWindowReset);
    window.addEventListener("dragend", handleWindowReset);
    window.addEventListener("drop", handleWindowReset);
    return () => {
      window.removeEventListener("blur", handleWindowReset);
      window.removeEventListener("dragend", handleWindowReset);
      window.removeEventListener("drop", handleWindowReset);
    };
  }, [resetDragState]);

  const validateFile = (file: File): { valid: boolean; reason?: string } => {
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const configuredExtensions = attachmentConfig.allowedExtensions;
    const allowedForMode = chatMode === "agent"
      ? configuredExtensions
      : DIRECT_CHAT_ATTACHMENT_EXTENSIONS.filter((extension) => configuredExtensions === null || configuredExtensions.includes(extension));
    if (allowedForMode !== null && !allowedForMode.includes(ext)) {
      return {
        valid: false,
        reason: t(chatMode === "agent" ? "dashboard:chatWorkspace.unsupportedFileFormat" : "dashboard:chatWorkspace.directModeUnsupportedFileFormat", { name: file.name })
      };
    }
    if (attachmentConfig.maxFileSizeBytes !== null && file.size > attachmentConfig.maxFileSizeBytes) {
      return {
        valid: false,
        reason: t("dashboard:chatWorkspace.fileTooLarge", { name: file.name, max: Math.round(attachmentConfig.maxFileSizeBytes / (1024 * 1024)) })
      };
    }
    if (file.size === 0) {
      return {
        valid: false,
        reason: t("dashboard:chatWorkspace.emptyFileNotAllowed", { name: file.name })
      };
    }
    return { valid: true };
  };

  const handleUploadFiles = async (inputFiles: FileList | File[]) => {
    if (!selectedId) {
      showToast(t("dashboard:chatWorkspace.selectInstanceToStart"), "warning");
      return;
    }

    if (!isChatReady) {
      showToast(t("dashboard:chatWorkspace.dropFilesNotReadyDesc"), "warning");
      return;
    }

    if (!selectedConversationId) {
      showToast(t("dashboard:chatWorkspace.dropFilesNoConversation"), "warning");
      return;
    }

    if (uploadInFlightRef.current || isUploading) {
      showToast(t("dashboard:chatWorkspace.attachmentUploading"), "warning");
      return;
    }

    const rawFiles = Array.from(inputFiles);
    if (rawFiles.length === 0) return;

    const remainingSlots = remainingChatAttachmentSlots(pendingAttachments.length, attachmentConfig.maxFiles);
    if (remainingSlots !== null && remainingSlots <= 0) {
      showToast(t("dashboard:chatWorkspace.attachmentLimitReachedDesc"), "warning");
      return;
    }

    const validFiles: File[] = [];
    const errorMessages: string[] = [];

    for (const file of rawFiles) {
      const check = validateFile(file);
      if (check.valid) {
        validFiles.push(file);
      } else if (check.reason) {
        errorMessages.push(check.reason);
      }
    }

    if (errorMessages.length > 0) {
      showToast(errorMessages.join("; "), "warning");
    }

    if (validFiles.length === 0) {
      return;
    }

    let filesToUpload = validFiles;
    if (remainingSlots !== null && validFiles.length > remainingSlots) {
      filesToUpload = validFiles.slice(0, remainingSlots);
      const ignoredCount = validFiles.length - remainingSlots;
      showToast(
        t("dashboard:chatWorkspace.attachmentPartialAccepted", {
          count: remainingSlots,
          ignored: ignoredCount
        }),
        "info"
      );
    }

    const uploadInstanceId = selectedId;
    const uploadConvId = selectedConversationId;

    uploadInFlightRef.current = true;
    setIsUploading(true);

    try {
      const res = await api.uploadChatFiles(uploadInstanceId, uploadConvId, filesToUpload);
      if (res && res.success && Array.isArray(res.files)) {
        if (selectedIdRef.current === uploadInstanceId && selectedConversationIdRef.current === uploadConvId) {
          setPendingAttachments(prev => {
            const next = dedupeConversationFiles([...prev, ...res.files]);
            return attachmentConfig.maxFiles === null ? next : next.slice(0, attachmentConfig.maxFiles);
          });
          setConversationFiles(prev => dedupeConversationFiles([...res.files, ...prev]));
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || t("dashboard:chatWorkspace.uploadFailed"), "error");
    } finally {
      uploadInFlightRef.current = false;
      setIsUploading(false);
    }
  };

  const isFileDrag = (e: React.DragEvent<HTMLElement>): boolean => {
    const types = e.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes("Files"));
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer) {
      const remaining = remainingChatAttachmentSlots(pendingAttachments.length, attachmentConfig.maxFiles);
      if (!isChatReady || !selectedConversationId || remaining === 0 || isUploading || uploadInFlightRef.current) {
        e.dataTransfer.dropEffect = "none";
      } else {
        e.dataTransfer.dropEffect = "copy";
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (dragCounterRef.current <= 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);

    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    type DataTransferItemWithEntry = DataTransferItem & {
      webkitGetAsEntry?: () => {
        isDirectory?: boolean;
      } | null;
    };

    let hasFolder = false;
    const nonFolderFiles: File[] = [];

    if (e.dataTransfer?.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i] as DataTransferItemWithEntry;
        if (item && item.kind === "file") {
          let isDir = false;
          try {
            if (typeof item.webkitGetAsEntry === "function") {
              const entry = item.webkitGetAsEntry();
              if (entry && entry.isDirectory) {
                isDir = true;
              }
            }
          } catch (err) {
            console.warn("[Drag&Drop] webkitGetAsEntry failed:", err);
          }

          if (isDir) {
            hasFolder = true;
          } else {
            const file = item.getAsFile();
            if (file) {
              nonFolderFiles.push(file);
            }
          }
        }
      }
    }

    if (hasFolder) {
      showToast(t("dashboard:chatWorkspace.folderUploadUnsupported"), "warning");
    }

    const filesToUpload = nonFolderFiles.length > 0 ? nonFolderFiles : (hasFolder ? [] : Array.from(e.dataTransfer?.files || []));
    if (filesToUpload.length > 0) {
      void handleUploadFiles(filesToUpload);
    }
  };

  const handleRemoveAttachment = async (fileId: string) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      setPendingAttachments(prev => prev.filter(a => a.id !== fileId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg || t("dashboard:chatWorkspace.fileDeleteFailed"), "error");
    }
  };

  const normalizeGeneratedInstanceFilePath = (rawPath: string) => {
    const cleaned = rawPath
      .trim()
      .replace(/^[`*_]+|[`*_]+$/g, "")
      .replace(/(?:[`*_]+|[.,;:!?，。；：！？]+)$/gu, "")
      .replace(/\\/g, "/");
    return cleaned.replace(/^\/?opt\/data\//i, "").replace(/^\/+/, "");
  };

  const getFileNameFromPath = (filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.split("/").filter(Boolean).pop() || "download";
  };

  const buildInstanceFilePreview = (filePath: string, size = 0, mimeType = ""): PendingAttachment => ({
    id: "instance:" + filePath,
    originalName: getFileNameFromPath(filePath),
    mimeType,
    size
  });

  const getPreviewKindByName = (fileName: string, mimeType = ""): ConversationFilePreview["kind"] => {
    const normalizedMime = mimeType.toLowerCase();
    const name = fileName.toLowerCase();
    if (normalizedMime.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(name)) return "image";
    if (normalizedMime.includes("html") || /\.html?$/i.test(name)) return "html";
    if (normalizedMime.includes("pdf") || name.endsWith(".pdf")) return "pdf";
    if (/\.(md|markdown)$/i.test(name)) return "markdown";
    if (
      normalizedMime.startsWith("text/") ||
      /\.(txt|csv|tsv|json|jsonl|log|yaml|yml|xml|ini|conf|env)$/i.test(name)
    ) return "text";
    if (/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i.test(name)) return "office";
    return "unsupported";
  };

  const normalizePreviewBlob = (blob: Blob, kind: ConversationFilePreview["kind"]) => {
    if (kind === "html" && !blob.type.toLowerCase().includes("html")) {
      return new Blob([blob], { type: "text/html;charset=utf-8" });
    }
    if (kind === "pdf" && !blob.type.toLowerCase().includes("pdf")) {
      return new Blob([blob], { type: "application/pdf" });
    }
    if ((kind === "text" || kind === "markdown") && !blob.type.toLowerCase().startsWith("text/")) {
      return new Blob([blob], { type: kind === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
    }
    return blob;
  };

  const saveBlobFromResponse = async (response: Response, fallbackName: string) => {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fallbackName || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const handleOpenInstanceFilePath = async (rawPath: string) => {
    if (!selectedIdRef.current) return;
    const filePath = normalizeGeneratedInstanceFilePath(rawPath);
    if (!filePath) return;

    const request = beginPreviewRequest(`instance:${filePath}`);
    const capturedInstanceId = request.instanceId;
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }

    const loadingFile = buildInstanceFilePreview(filePath);
    setConversationFilePreview({ file: loadingFile, kind: "unsupported", source: "instance", instancePath: filePath, loading: true });

    try {
      const response = await api.getRaw(`/api/instances/${capturedInstanceId}/files/download?path=${encodeURIComponent(filePath)}`, { signal: request.signal });
      const blob = await response.blob();
      if (!isPreviewRequestCurrent(request)) return;
      const mimeType = blob.type || loadingFile.mimeType || "";
      const previewFile = buildInstanceFilePreview(filePath, blob.size, mimeType);
      const kind = getPreviewKindByName(previewFile.originalName, mimeType);
      const previewBlob = normalizePreviewBlob(blob, kind);

      if (kind === "text" || kind === "markdown") {
        const text = await previewBlob.text();
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({ file: previewFile, kind, source: "instance", instancePath: filePath, text });
        return;
      }

      const url = window.URL.createObjectURL(previewBlob);
      const htmlText = kind === "html" ? await previewBlob.text() : undefined;
      if (!isPreviewRequestCurrent(request)) {
        window.URL.revokeObjectURL(url);
        return;
      }
      conversationFilePreviewUrlRef.current = url;
      setConversationFilePreview({
        file: previewFile,
        kind,
        source: "instance",
        instancePath: filePath,
        url,
        text: htmlText,
        error: kind === "office" || kind === "unsupported"
          ? t("dashboard:chatWorkspace.workspacePreviewUnsupportedDesc")
          : undefined
      });
    } catch (err: any) {
      if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
      const message = err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed");
      setConversationFilePreview({ file: loadingFile, kind: "unsupported", source: "instance", instancePath: filePath, error: message });
      showToast(message, "error");
    }
  };
  const handleDownloadConversationFile = async (file: PendingAttachment) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      const response = await api.downloadChatFile(selectedId, selectedConversationId, file.id, "attachment");
      await saveBlobFromResponse(response, file.originalName);
    } catch (err: any) {
      showToast(err?.message || t("dashboard:chatWorkspace.fileDownloadFailed"), "error");
    }
  };

  const handleOpenConversationFile = async (file: PendingAttachment) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      const response = await api.downloadChatFile(selectedId, selectedConversationId, file.id, "inline");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      showToast(err?.message || t("dashboard:chatWorkspace.fileOpenFailed"), "error");
    }
  };

  const getPreviewKind = (file: PendingAttachment, blob: Blob): ConversationFilePreview["kind"] => {
    return getPreviewKindByName(file.originalName, blob.type || file.mimeType || "");
  };

  const handlePreviewConversationFile = async (file: PendingAttachment) => {
    if (!selectedIdRef.current || !selectedConversationIdRef.current) return;
    const request = beginPreviewRequest(`conversation:${file.id}`);
    const capturedInstanceId = request.instanceId;
    const capturedConversationId = request.conversationId;
    if (!capturedConversationId) return;
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }
    setConversationFilePreview({ file, kind: "unsupported", source: "conversation", loading: true });
    try {
      const response = await api.downloadChatFile(capturedInstanceId, capturedConversationId, file.id, "inline", { signal: request.signal });
      const blob = await response.blob();
      if (!isPreviewRequestCurrent(request)) return;
      const kind = getPreviewKind(file, blob);
      const previewBlob = normalizePreviewBlob(blob, kind);
      if (kind === "text" || kind === "markdown") {
        const text = await previewBlob.text();
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({ file, kind, source: "conversation", text });
        return;
      }
      if (kind === "image" || kind === "html" || kind === "pdf") {
        const url = window.URL.createObjectURL(previewBlob);
        const htmlText = kind === "html" ? await previewBlob.text() : undefined;
        if (!isPreviewRequestCurrent(request)) {
          window.URL.revokeObjectURL(url);
          return;
        }
        conversationFilePreviewUrlRef.current = url;
        setConversationFilePreview({ file, kind, source: "conversation", url, text: htmlText });
        return;
      }
      if (!isPreviewRequestCurrent(request)) return;
      setConversationFilePreview({
        file,
        kind,
        source: "conversation",
        error: t("dashboard:chatWorkspace.workspacePreviewUnsupportedDesc")
      });
    } catch (err: any) {
      if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
      setConversationFilePreview({
        file,
        kind: "unsupported",
        source: "conversation",
        error: err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed")
      });
    }
  };
  const handleDeleteConversationFile = async (fileId: string) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      await api.deleteChatFile(selectedId, selectedConversationId, fileId);
      setConversationFiles(prev => prev.filter(a => a.id !== fileId));
      setPendingAttachments(prev => prev.filter(a => a.id !== fileId));
    } catch (err: any) {
      showToast(err?.message || t("dashboard:chatWorkspace.fileDeleteFailed"), "error");
    }
  };

  return {
    attachmentConfig,
    attachmentLimitReached: isChatAttachmentLimitReached(pendingAttachments.length, attachmentConfig.maxFiles),
    remainingAttachmentSlots: remainingChatAttachmentSlots(pendingAttachments.length, attachmentConfig.maxFiles),
    pendingAttachments,
    setPendingAttachments,
    conversationFiles,
    setConversationFiles,
    conversationFilePreview,
    clearConversationFilePreview,
    isUploading,
    isDraggingOver,
    uploadInFlightRef,
    refreshConversationFiles,
    handleUploadFiles,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleRemoveAttachment,
    handleOpenInstanceFilePath,
    handleDownloadConversationFile,
    handleOpenConversationFile,
    handlePreviewConversationFile,
    handleDeleteConversationFile
  };
}
