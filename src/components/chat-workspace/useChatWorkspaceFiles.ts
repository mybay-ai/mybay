import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { uploadChatFile } from "../../lib/chatFileUpload";
import { createAttachmentUploadQueue, type AttachmentUploadItem } from "./attachmentUploadQueue";
import { createPreviewRequestGuard, isPreviewAbortError, type PreviewRequestToken } from "./previewRequestGuard";
import {
  isHtmlPreviewFile,
  LOCAL_TEXT_PREVIEW_MAX_BYTES,
} from "./previewSecurity";
import { type PendingAttachment } from "./ChatInputBar";
import {
  DEFAULT_CHAT_ATTACHMENT_CONFIG,
  DIRECT_CHAT_ATTACHMENT_EXTENSIONS,
  isChatAttachmentLimitReached,
  remainingChatAttachmentSlots,
  type ChatAttachmentConfig
} from "../../../shared/chatAttachmentContract";
import { normalizeGeneratedInstanceFilePath } from "./generatedFilePath";
import {
  clearGeneratedPreviewSelection,
  clearPreviewSelection,
  loadPreviewSelection,
  saveGeneratedPreviewSelection,
  savePreviewSelection,
} from "./previewSelectionStorage";
import { buildWorkspaceFileContextKey, selectWorkspaceFileContextValue } from "./workspaceFileContext";
import { getWorkspacePreviewKind, type WorkspacePreviewKind } from "./workspacePreviewKind";

type ShowToast = (message: string, type?: "success" | "info" | "warning" | "error", duration?: number) => void;

export type ConversationFilePreview = {
  file: PendingAttachment;
  kind: WorkspacePreviewKind;
  contextKey?: string;
  source?: "conversation" | "instance";
  instancePath?: string;
  loading?: boolean;
  url?: string;
  htmlPreviewUrl?: string;
  downloadUrl?: string;
  officeHtml?: string;
  text?: string;
  error?: string;
  errorCode?: string;
  missingDependencies?: string[];
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
  const [conversationFilesContextKey, setConversationFilesContextKey] = useState("");
  const [conversationFilePreview, setConversationFilePreview] = useState<ConversationFilePreview | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadItems, setUploadItems] = useState<AttachmentUploadItem[]>([]);
  const uploadQueueRef = useRef<ReturnType<typeof createAttachmentUploadQueue> | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const selectedIdRef = useRef(selectedId);
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const conversationFilePreviewUrlRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const filesRequestRef = useRef<{ controller: AbortController; revision: number } | null>(null);
  const filesRevisionRef = useRef(0);
  const previewRequestGuardRef = useRef(createPreviewRequestGuard());

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    setUploadItems([]); setIsUploading(false); uploadInFlightRef.current = false;
    const queue = createAttachmentUploadQueue({
      upload: (file, options) => uploadChatFile(selectedId, selectedConversationId!, file, options),
      onChange: items => {
        setUploadItems(items);
        const busy = items.some(item => ["queued", "uploading", "confirming"].includes(item.status));
        uploadInFlightRef.current = busy; setIsUploading(busy);
      },
      onUploaded: file => {
        if (selectedIdRef.current !== selectedId || selectedConversationIdRef.current !== selectedConversationId) return;
        setPendingAttachments(prev => dedupeConversationFiles([...prev, file]));
        setConversationFiles(prev => dedupeConversationFiles([file, ...prev]));
        setConversationFilesContextKey(buildWorkspaceFileContextKey(selectedId, selectedConversationId));
      },
    });
    uploadQueueRef.current = queue;
    return () => { queue.dispose(); if (uploadQueueRef.current === queue) uploadQueueRef.current = null; };
  }, [selectedId, selectedConversationId]);

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

  const resetConversationFilePreview = useCallback(() => {
    invalidatePreviewRequests();
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }
    setConversationFilePreview(null);
  }, [invalidatePreviewRequests]);

  const clearConversationFilePreview = useCallback(() => {
    clearPreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      selectedIdRef.current,
      selectedConversationIdRef.current || ""
    );
    clearGeneratedPreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      selectedIdRef.current,
      selectedConversationIdRef.current || ""
    );
    resetConversationFilePreview();
  }, [resetConversationFilePreview]);

  const refreshConversationFiles = useCallback(async (instanceId: string, conversationId: string | null) => {
    // Only the current pair may cancel/start its list request.
    if (selectedIdRef.current !== instanceId || selectedConversationIdRef.current !== conversationId) return;
    filesRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const revision = ++filesRevisionRef.current;
    filesRequestRef.current = { controller, revision };
    if (!instanceId || !conversationId) {
      setConversationFiles([]);
      setConversationFilesContextKey("");
      return;
    }

    try {
      const res = await api.listChatFiles(instanceId, conversationId, { signal: controller.signal });
      if (
        !controller.signal.aborted && filesRevisionRef.current === revision &&
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === conversationId
      ) {
        setConversationFiles(dedupeConversationFiles(Array.isArray(res?.files) ? res.files : []));
        setConversationFilesContextKey(buildWorkspaceFileContextKey(instanceId, conversationId));
      }
    } catch (err) {
      if (
        !controller.signal.aborted && filesRevisionRef.current === revision &&
        selectedIdRef.current === instanceId &&
        selectedConversationIdRef.current === conversationId
      ) {
        if (![403, 404, 410].includes((err as { status?: number })?.status ?? 0)) console.warn("Failed to refresh conversation files:", err);
        setConversationFiles([]);
        setConversationFilesContextKey(buildWorkspaceFileContextKey(instanceId, conversationId));
      }
    }
  }, []);

  useEffect(() => {
    return () => resetConversationFilePreview();
  }, [resetConversationFilePreview]);

  useEffect(() => {
    resetConversationFilePreview();
    setPendingAttachments([]);
    setConversationFiles([]);
    setConversationFilesContextKey("");
    void refreshConversationFiles(selectedId, selectedConversationId);
    return () => { filesRequestRef.current?.controller.abort(); filesRevisionRef.current += 1; };
  }, [selectedId, selectedConversationId, resetConversationFilePreview, refreshConversationFiles]);

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

    const remainingSlots = remainingChatAttachmentSlots(pendingAttachments.length + (uploadQueueRef.current?.size() ?? 0), attachmentConfig.maxFiles);
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

    uploadQueueRef.current?.add(filesToUpload);
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

  const normalizePreviewBlob = (blob: Blob, kind: ConversationFilePreview["kind"], fileName = "") => {
    if (kind === "html" && !blob.type.toLowerCase().includes("html")) {
      return new Blob([blob], { type: "text/html;charset=utf-8" });
    }
    if (kind === "pdf" && !blob.type.toLowerCase().includes("pdf")) {
      return new Blob([blob], { type: "application/pdf" });
    }
    if ((kind === "text" || kind === "markdown") && !blob.type.toLowerCase().startsWith("text/")) {
      return new Blob([blob], { type: kind === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
    }
    if (kind === "video" && !blob.type.toLowerCase().startsWith("video/")) {
      return new Blob([blob], { type: /\.mov$/i.test(fileName) ? "video/quicktime" : "video/mp4" });
    }
    return blob;
  };

  const isMemoryBoundTextPreview = (kind: ConversationFilePreview["kind"]) => (
    kind === "text" || kind === "markdown" || kind === "html"
  );

  const getPreviewTooLargeMessage = useCallback(() => t("dashboard:chatWorkspace.workspacePreviewTooLarge", {
    max: Math.round(LOCAL_TEXT_PREVIEW_MAX_BYTES / (1024 * 1024))
  }), [t]);

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
    if (!filePath) {
      showToast(t("dashboard:chatWorkspace.workspaceInvalidGeneratedPath"), "warning");
      return;
    }

    const request = beginPreviewRequest(`instance:${filePath}`);
    const capturedInstanceId = request.instanceId;
    clearPreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      capturedInstanceId,
      request.conversationId || ""
    );
    saveGeneratedPreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      capturedInstanceId,
      request.conversationId || "",
      filePath
    );
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }

    const loadingFile = buildInstanceFilePreview(filePath);
    const contextKey = buildWorkspaceFileContextKey(request.instanceId, request.conversationId);
    setConversationFilePreview({ file: loadingFile, kind: "unsupported", contextKey, source: "instance", instancePath: filePath, loading: true });

    const initialPreviewKind = getWorkspacePreviewKind(loadingFile.originalName);
    if (initialPreviewKind === "video") {
      const videoFile = buildInstanceFilePreview(
        filePath,
        0,
        /\.mov$/i.test(loadingFile.originalName) ? "video/quicktime" : "video/mp4"
      );
      setConversationFilePreview({
        file: videoFile,
        kind: "video",
        contextKey,
        source: "instance",
        instancePath: filePath,
        url: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/media-preview?path=${encodeURIComponent(filePath)}`,
        downloadUrl: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/download?path=${encodeURIComponent(filePath)}`,
      });
      return;
    }

    if (initialPreviewKind === "office") {
      try {
        const preview = await api.get(`/api/instances/${encodeURIComponent(capturedInstanceId)}/files/office-preview?path=${encodeURIComponent(filePath)}`, { signal: request.signal });
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({
          file: loadingFile,
          kind: "office",
          contextKey,
          source: "instance",
          instancePath: filePath,
          officeHtml: typeof preview?.html === "string" ? preview.html : "",
          downloadUrl: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/download?path=${encodeURIComponent(filePath)}`,
        });
      } catch (err: any) {
        if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({
          file: loadingFile,
          kind: "office",
          contextKey,
          source: "instance",
          instancePath: filePath,
          downloadUrl: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/download?path=${encodeURIComponent(filePath)}`,
          error: err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed"),
        });
      }
      return;
    }

    if (initialPreviewKind === "html") {
      try {
        const metadata = await api.get(`/api/instances/${encodeURIComponent(capturedInstanceId)}/files/metadata?path=${encodeURIComponent(filePath)}`, { signal: request.signal });
        if (!isPreviewRequestCurrent(request)) return;
        if (metadata?.artifact?.previewStatus === "incomplete") {
          const missingDependencies = (Array.isArray(metadata?.artifact?.previewDependencies)
            ? metadata.artifact.previewDependencies
            : [])
            .filter((dependency: any) => dependency?.status === "missing" || dependency?.status === "unsupported")
            .map((dependency: any) => String(dependency?.reference || dependency?.requestPath || "").trim())
            .filter(Boolean);
          setConversationFilePreview({
            file: buildInstanceFilePreview(filePath, Number(metadata?.size || 0), String(metadata?.mime || "text/html")),
            kind: "html",
            contextKey,
            source: "instance",
            instancePath: filePath,
            downloadUrl: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/download?path=${encodeURIComponent(filePath)}`,
            errorCode: "HTML_PREVIEW_DEPENDENCIES_MISSING",
            missingDependencies,
            error: t("dashboard:chatWorkspace.workspaceHtmlPreviewDependenciesMissing", {
              files: missingDependencies.join(", ") || t("dashboard:chatWorkspace.workspaceHtmlPreviewUnknownDependency")
            }),
          });
          return;
        }
      } catch (err: any) {
        if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({
          file: loadingFile,
          kind: "html",
          contextKey,
          source: "instance",
          instancePath: filePath,
          downloadUrl: `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/download?path=${encodeURIComponent(filePath)}`,
          errorCode: err?.code || "HTML_PREVIEW_PREFLIGHT_FAILED",
          error: err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed"),
        });
        return;
      }
    }

    try {
      const response = await api.getRaw(`/api/instances/${capturedInstanceId}/files/download?path=${encodeURIComponent(filePath)}`, { signal: request.signal });
      const declaredMimeType = response.headers.get("content-type") || loadingFile.mimeType || "";
      const declaredKind = getWorkspacePreviewKind(loadingFile.originalName, declaredMimeType);
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (isMemoryBoundTextPreview(declaredKind) && declaredSize > LOCAL_TEXT_PREVIEW_MAX_BYTES) {
        throw new Error("PREVIEW_TOO_LARGE");
      }
      const blob = await response.blob();
      if (!isPreviewRequestCurrent(request)) return;
      const mimeType = blob.type || loadingFile.mimeType || "";
      const previewFile = buildInstanceFilePreview(filePath, blob.size, mimeType);
      const kind = getWorkspacePreviewKind(previewFile.originalName, mimeType);
      if (isMemoryBoundTextPreview(kind) && blob.size > LOCAL_TEXT_PREVIEW_MAX_BYTES) {
        throw new Error("PREVIEW_TOO_LARGE");
      }
      const previewBlob = normalizePreviewBlob(blob, kind, previewFile.originalName);

      if (kind === "text" || kind === "markdown") {
        const text = await previewBlob.text();
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({ file: previewFile, kind, contextKey, source: "instance", instancePath: filePath, text });
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
        contextKey,
        source: "instance",
        instancePath: filePath,
        url,
        htmlPreviewUrl: kind === "html"
          ? `/api/instances/${encodeURIComponent(capturedInstanceId)}/files/html-preview?path=${encodeURIComponent(filePath)}`
          : undefined,
        text: htmlText,
        error: kind === "office" || kind === "unsupported"
          ? t("dashboard:chatWorkspace.workspacePreviewUnsupportedDesc")
          : undefined
      });
    } catch (err: any) {
      if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
      const message = err?.message === "PREVIEW_TOO_LARGE"
        ? getPreviewTooLargeMessage()
        : (err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed"));
      setConversationFilePreview({ file: loadingFile, kind: "unsupported", contextKey, source: "instance", instancePath: filePath, error: message });
      showToast(message, "error");
    }
  };

  const handleDownloadInstanceFilePath = async (rawPath: string) => {
    const instanceId = selectedIdRef.current;
    const filePath = normalizeGeneratedInstanceFilePath(rawPath);
    if (!instanceId || !filePath) {
      showToast(t("dashboard:chatWorkspace.workspaceInvalidGeneratedPath"), "warning");
      return;
    }
    try {
      const response = await api.getRaw(`/api/instances/${encodeURIComponent(instanceId)}/files/download?path=${encodeURIComponent(filePath)}`);
      await saveBlobFromResponse(response, getFileNameFromPath(filePath));
    } catch (err: any) {
      showToast(err?.message || t("dashboard:chatWorkspace.fileDownloadFailed"), "error");
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

  const handleOpenConversationFile = (file: PendingAttachment) => {
    if (!selectedId || !selectedConversationId) return;
    // Navigate during the click gesture. Cookie authentication, file guards and
    // CSP stay on the server; no blob allocation or delayed popup is needed.
    const route = `/api/instances/${encodeURIComponent(selectedId)}/conversations/${encodeURIComponent(selectedConversationId)}/files/${encodeURIComponent(file.id)}`;
    const url = isHtmlPreviewFile(file.originalName, file.mimeType)
      ? `${route}/html-preview`
      : `${route}/download?disposition=inline`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const getPreviewKind = (file: PendingAttachment, blob: Blob): ConversationFilePreview["kind"] => {
    return getWorkspacePreviewKind(file.originalName, blob.type || file.mimeType || "");
  };

  const handlePreviewConversationFile = useCallback(async (file: PendingAttachment) => {
    if (!selectedIdRef.current || !selectedConversationIdRef.current) return;
    const request = beginPreviewRequest(`conversation:${file.id}`);
    const capturedInstanceId = request.instanceId;
    const capturedConversationId = request.conversationId;
    if (!capturedConversationId) return;
    savePreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      capturedInstanceId,
      capturedConversationId,
      file.id
    );
    clearGeneratedPreviewSelection(
      typeof window === "undefined" ? null : window.sessionStorage,
      capturedInstanceId,
      capturedConversationId
    );
    if (conversationFilePreviewUrlRef.current) {
      window.URL.revokeObjectURL(conversationFilePreviewUrlRef.current);
      conversationFilePreviewUrlRef.current = null;
    }
    const contextKey = buildWorkspaceFileContextKey(capturedInstanceId, capturedConversationId);
    setConversationFilePreview({ file, kind: "unsupported", contextKey, source: "conversation", loading: true });
    const initialPreviewKind = getWorkspacePreviewKind(file.originalName, file.mimeType);
    if (initialPreviewKind === "video") {
      setConversationFilePreview({
        file,
        kind: "video",
        contextKey,
        source: "conversation",
        url: `/api/instances/${encodeURIComponent(capturedInstanceId)}/conversations/${encodeURIComponent(capturedConversationId)}/files/${encodeURIComponent(file.id)}/media-preview`,
      });
      return;
    }
    if (initialPreviewKind === "office") {
      try {
        const preview = await api.get(`/api/instances/${encodeURIComponent(capturedInstanceId)}/conversations/${encodeURIComponent(capturedConversationId)}/files/${encodeURIComponent(file.id)}/office-preview`, { signal: request.signal });
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({
          file,
          kind: "office",
          contextKey,
          source: "conversation",
          officeHtml: typeof preview?.html === "string" ? preview.html : "",
        });
      } catch (err: any) {
        if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({ file, kind: "office", contextKey, source: "conversation", error: err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed") });
      }
      return;
    }
    try {
      const response = await api.downloadChatFile(capturedInstanceId, capturedConversationId, file.id, "inline", { signal: request.signal });
      const declaredMimeType = response.headers.get("content-type") || file.mimeType || "";
      const declaredKind = getWorkspacePreviewKind(file.originalName, declaredMimeType);
      const declaredSize = Number(response.headers.get("content-length") || file.size || 0);
      if (isMemoryBoundTextPreview(declaredKind) && declaredSize > LOCAL_TEXT_PREVIEW_MAX_BYTES) {
        throw new Error("PREVIEW_TOO_LARGE");
      }
      const blob = await response.blob();
      if (!isPreviewRequestCurrent(request)) return;
      const kind = getWorkspacePreviewKind(file.originalName, blob.type || file.mimeType || "");
      if (isMemoryBoundTextPreview(kind) && blob.size > LOCAL_TEXT_PREVIEW_MAX_BYTES) {
        throw new Error("PREVIEW_TOO_LARGE");
      }
      const previewBlob = normalizePreviewBlob(blob, kind, file.originalName);
      if (kind === "text" || kind === "markdown") {
        const text = await previewBlob.text();
        if (!isPreviewRequestCurrent(request)) return;
        setConversationFilePreview({ file, kind, contextKey, source: "conversation", text });
        return;
      }
      if (kind === "image" || kind === "html" || kind === "pdf" || kind === "video") {
        const url = window.URL.createObjectURL(previewBlob);
        const htmlText = kind === "html" ? await previewBlob.text() : undefined;
        if (!isPreviewRequestCurrent(request)) {
          window.URL.revokeObjectURL(url);
          return;
        }
        conversationFilePreviewUrlRef.current = url;
        setConversationFilePreview({
          file,
          kind,
          contextKey,
          source: "conversation",
          url,
          htmlPreviewUrl: kind === "html"
            ? `/api/instances/${encodeURIComponent(capturedInstanceId)}/conversations/${encodeURIComponent(capturedConversationId)}/files/${encodeURIComponent(file.id)}/html-preview`
            : undefined,
          text: htmlText
        });
        return;
      }
      if (!isPreviewRequestCurrent(request)) return;
      setConversationFilePreview({
        file,
        kind,
        contextKey,
        source: "conversation",
        error: t("dashboard:chatWorkspace.workspacePreviewUnsupportedDesc")
      });
    } catch (err: any) {
      if (isPreviewAbortError(err) || !isPreviewRequestCurrent(request)) return;
      setConversationFilePreview({
        file,
        kind: "unsupported",
        contextKey,
        source: "conversation",
        error: err?.message === "PREVIEW_TOO_LARGE"
          ? getPreviewTooLargeMessage()
          : (err?.message || t("dashboard:chatWorkspace.workspacePreviewLoadFailed"))
      });
    }
  }, [beginPreviewRequest, getPreviewTooLargeMessage, isPreviewRequestCurrent, t]);

  useEffect(() => {
    if (!selectedId || !selectedConversationId || conversationFilePreview || conversationFiles.length === 0) return;
    const selectedFileId = loadPreviewSelection(window.sessionStorage, selectedId, selectedConversationId);
    if (!selectedFileId) return;
    const selectedFile = conversationFiles.find(file => file.id === selectedFileId);
    if (!selectedFile) {
      clearPreviewSelection(window.sessionStorage, selectedId, selectedConversationId);
      return;
    }
    void handlePreviewConversationFile(selectedFile);
  }, [conversationFilePreview, conversationFiles, handlePreviewConversationFile, selectedConversationId, selectedId]);
  const handleDeleteConversationFile = async (fileId: string) => {
    if (!selectedId || !selectedConversationId) return;
    try {
      await api.deleteChatFile(selectedId, selectedConversationId, fileId);
      setConversationFiles(prev => prev.filter(a => a.id !== fileId));
      setPendingAttachments(prev => prev.filter(a => a.id !== fileId));
      if (conversationFilePreview?.file.id === fileId) {
        clearConversationFilePreview();
      }
    } catch (err: any) {
      showToast(err?.message || t("dashboard:chatWorkspace.fileDeleteFailed"), "error");
    }
  };

  const scopedConversationFiles = selectWorkspaceFileContextValue(
    conversationFiles,
    conversationFilesContextKey,
    selectedId,
    selectedConversationId
  ) || [];
  const scopedConversationFilePreview = selectWorkspaceFileContextValue(
    conversationFilePreview,
    conversationFilePreview?.contextKey,
    selectedId,
    selectedConversationId
  );

  return {
    attachmentConfig,
    attachmentLimitReached: isChatAttachmentLimitReached(pendingAttachments.length, attachmentConfig.maxFiles),
    remainingAttachmentSlots: remainingChatAttachmentSlots(pendingAttachments.length, attachmentConfig.maxFiles),
    pendingAttachments,
    setPendingAttachments,
    conversationFiles: scopedConversationFiles,
    setConversationFiles,
    conversationFilePreview: scopedConversationFilePreview,
    clearConversationFilePreview,
    isUploading,
    attachmentUploads: {
      items: uploadItems,
      onCancel: (id: string) => uploadQueueRef.current?.cancel(id),
      onRetry: (id: string) => { if (isChatReady) uploadQueueRef.current?.retry(id); },
      onDismiss: (id: string) => uploadQueueRef.current?.dismiss(id),
    },
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
    handleDownloadInstanceFilePath,
    handleDownloadConversationFile,
    handleOpenConversationFile,
    handlePreviewConversationFile,
    handleDeleteConversationFile
  };
}
