import type { ConversationPlacement } from "../../../shared/localConversationPlacement";
import { createConversationTitle } from "./conversationTitleText";
import { useRef, useState } from "react";
import type { Dispatch, MouseEvent, MutableRefObject, SetStateAction, UIEvent } from "react";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { shouldAcceptConversationHistory } from "../../lib/chatWorkspaceState";
import type { PendingAttachment } from "./ChatInputBar";
import { mergePersistedOrder, moveOrderedRecord, sortConversationRecords, sortProjectRecords } from "./localConversationOrdering";
import { resolveRememberedConversation } from "./chatSelectionPersistence";

type ConversationRecord = any;
type ChatProjectRecord = any;

type ConfirmOptions = {
  title: string;
  message: string;
  type?: "danger" | "warning" | "info" | "success";
  confirmText?: string;
  cancelText?: string;
};

type UseChatConversationsOptions = {
  selectedId: string;
  selectedIdRef: MutableRefObject<string>;
  selectedConversationId: string | null;
  selectedConversationIdRef: MutableRefObject<string | null>;
  selectionRevisionRef: MutableRefObject<number>;
  getRememberedConversationId: (instanceId: string) => string | null;
  selectConversationId: (id: string | null) => void;
  instanceGenerationRef: MutableRefObject<number>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setNextCursorSeq: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  setConversationFiles: Dispatch<SetStateAction<any[]>>;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
  t: TFunction;
};

export function useChatConversations({
  selectedId,
  selectedIdRef,
  selectedConversationIdRef,
  selectionRevisionRef,
  getRememberedConversationId,
  selectConversationId,
  instanceGenerationRef,
  setMessages,
  setNextCursorSeq,
  setError,
  setPendingAttachments,
  setConversationFiles,
  showConfirm,
  t
}: UseChatConversationsOptions) {
  const [conversations, setConversationsRaw] = useState<ConversationRecord[]>([]);
  const [conversationProjects, setConversationProjects] = useState<ChatProjectRecord[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [conversationsCursor, setConversationsCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const organizationRef = useRef<object | null>(null);
  const organizationRevisionRef = useRef(0);
  const [organizingConversations, setOrganizingConversations] = useState(false);
  const projectOrderMutationRef = useRef(0);
  const listRequestRef = useRef(0);
  const creationRequestRef = useRef(0);
  const conversationCreationInFlightRef = useRef(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const setConversations: Dispatch<SetStateAction<ConversationRecord[]>> = (value) => {
    setConversationsRaw(prev => sortConversationRecords(typeof value === "function" ? (value as (previous: ConversationRecord[]) => ConversationRecord[])(prev) : value));
  };

  const resetConversationsForInstance = () => {
    organizationRef.current = null;
    organizationRevisionRef.current += 1;
    setOrganizingConversations(false);
    creationRequestRef.current += 1;
    conversationCreationInFlightRef.current = false;
    setCreatingConversation(false);
    listRequestRef.current += 1;
    setLoadingConversations(false);
    setConversations([]);
    setConversationProjects([]);
    setConversationsCursor(null);
    setLoadingMoreConversations(false);
  };

  const loadConversationProjects = async (instanceId: string) => {
    const res = await api.get('/api/instances/' + instanceId + '/conversation-projects');
    if (res && res.success && Array.isArray(res.projects)) {
      setConversationProjects(sortProjectRecords(res.projects));
    }
  };

  const loadConversationsForSelectedInstance = async (initialSelectedId: string, currentInstanceGen: number, signal?: AbortSignal) => {
    const requestId = ++listRequestRef.current;
    const selectionRevision = selectionRevisionRef.current;
    const isCurrent = () => !signal?.aborted && listRequestRef.current === requestId && shouldAcceptConversationHistory(
      { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
      { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen },
    );
    if (!isCurrent()) return;
    try {
      setLoadingConversations(true);
      // Project labels can arrive later; they must not delay restoring messages.
      void api.get('/api/instances/' + initialSelectedId + '/conversation-projects', { signal }).then(projectsRes => {
        if (isCurrent() && projectsRes?.success && Array.isArray(projectsRes.projects)) {
          setConversationProjects(sortProjectRecords(projectsRes.projects));
        }
      }).catch(() => {});
      const res = await api.get('/api/instances/' + initialSelectedId + '/conversations?limit=20', { signal });
      if (!isCurrent() || selectionRevisionRef.current !== selectionRevision) return;
      if (res && res.success && Array.isArray(res.conversations)) {
        const restored = await resolveRememberedConversation(sortConversationRecords(res.conversations), getRememberedConversationId(initialSelectedId), async id => {
          const detail = await api.get(`/api/instances/${encodeURIComponent(initialSelectedId)}/conversations/${encodeURIComponent(id)}`, { signal });
          return detail?.success ? detail.conversation : null;
        });
        if (!isCurrent() || selectionRevisionRef.current !== selectionRevision) return;
        const sortedConversations = sortConversationRecords(restored.list);
        setConversationsRaw(sortedConversations);
        setConversationsCursor(res.nextCursor);

        selectConversationId(restored.selectedId);
        if (!restored.selectedId) {
          setMessages([]);
        }
      }
    } catch (err) {
      if (!isCurrent() || selectionRevisionRef.current !== selectionRevision) return;
      console.error("Failed to load conversations:", err);
      setError(t("dashboard:chatWorkspace.loadMessagesFailed"));
    } finally {
      if (isCurrent()) {
        setLoadingConversations(false);
      }
    }
  };

  const handleCreateConversation = async (projectId: string | null = null) => {
    if (!selectedId || conversationCreationInFlightRef.current || organizationRef.current) return;
    const requestId = ++creationRequestRef.current;
    conversationCreationInFlightRef.current = true;
    setCreatingConversation(true);
    const generation = instanceGenerationRef.current;
    const revision = selectionRevisionRef.current;
    const isCurrent = () => creationRequestRef.current === requestId && selectedIdRef.current === selectedId && instanceGenerationRef.current === generation && selectionRevisionRef.current === revision;
    try {
      const count = conversations.length + 1;
      const title = t("dashboard:chatWorkspace.newChatName", { count });
      const res = await api.post(`/api/instances/${selectedId}/conversations`, { title, ...(projectId ? { projectId } : {}) });
      if (!isCurrent()) return;
      if (res && res.success && res.conversation) {
        setPendingAttachments([]);
        setConversationFiles([]);
        setConversations(prev => [res.conversation, ...prev]);
        selectConversationId(res.conversation.id);
        setMessages([]);
        setNextCursorSeq(null);
        setError(null);
      } else {
        setError(t("dashboard:chatWorkspace.createConversationFailed"));
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error("Failed to create conversation:", err);
      setError(t("dashboard:chatWorkspace.createConversationFailed"));
    } finally {
      if (creationRequestRef.current === requestId) {
        conversationCreationInFlightRef.current = false;
        setCreatingConversation(false);
      }
    }
  };

  const handleCreateProject = async (name: string) => {
    if (!selectedId) return;
    const projectName = (name || "").trim();
    if (!projectName) return;

    try {
      const res = await api.post('/api/instances/' + selectedId + '/conversation-projects', { name: projectName });
      if (res && res.success && res.project) {
        setConversationProjects(prev => sortProjectRecords([res.project, ...prev]));
      }
    } catch (err) {
      console.error("Failed to create conversation project:", err);
      setError(t("dashboard:chatWorkspace.createProjectFailed"));
    }
  };

  const handleRenameProject = async (projectId: string, name: string) => {
    if (!selectedId) return;
    const projectName = (name || "").trim();
    if (!projectName) return;

    try {
      const res = await api.patch('/api/instances/' + selectedId + '/conversation-projects/' + projectId, { name: projectName });
      if (res && res.success && res.project) {
        setConversationProjects(prev => sortProjectRecords(prev.map(project => project.id === projectId ? res.project : project)));
      }
    } catch (err) {
      console.error("Failed to rename conversation project:", err);
      setError(t("dashboard:chatWorkspace.renameProjectFailed"));
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!selectedId) return;
    const project = conversationProjects.find(item => item.id === projectId);
    const confirmed = await showConfirm({
      title: t("dashboard:chatWorkspace.deleteProject"),
      message: t("dashboard:chatWorkspace.deleteProjectConfirm", { name: project?.name || "" }),
      type: "warning",
      confirmText: t("dashboard:chatWorkspace.confirm"),
      cancelText: t("dashboard:chatWorkspace.cancel")
    });
    if (!confirmed) return;

    try {
      const res = await api.delete('/api/instances/' + selectedId + '/conversation-projects/' + projectId);
      if (res && res.success) {
        setConversationProjects(prev => prev.filter(item => item.id !== projectId));
        setConversations(prev => prev.map(conv => conv.project_id === projectId ? { ...conv, project_id: null } : conv));
      }
    } catch (err) {
      console.error("Failed to delete conversation project:", err);
      setError(t("dashboard:chatWorkspace.deleteProjectFailed"));
    }
  };

  const handleMoveConversationToProject = async (convId: string, projectId: string | null) => {
    await handlePlaceConversation({ conversationId: convId, targetId: null, position: "after",
      section: projectId ? { kind: "project", projectId } : { kind: "recent" } });
  };

  const handleDeleteConversation = async (convId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!selectedId) return;
    const generation = instanceGenerationRef.current;
    const isCurrent = () => selectedIdRef.current === selectedId && instanceGenerationRef.current === generation;

    const confirmed = await showConfirm({
      title: t("dashboard:chatWorkspace.deleteChat"),
      message: t("dashboard:chatWorkspace.deleteChatConfirm"),
      type: "danger",
      confirmText: t("dashboard:chatWorkspace.confirm"),
      cancelText: t("dashboard:chatWorkspace.cancel")
    });
    if (!confirmed || !isCurrent()) return;

    try {
      const res = await api.delete(`/api/instances/${selectedId}/conversations/${convId}`);
      if (!isCurrent()) return;
      if (res && res.success) {
        const updatedList = conversationsRef.current.filter(c => c.id !== convId);
        setConversations(updatedList);
        if (selectedConversationIdRef.current === convId) {
          if (updatedList.length > 0) {
            selectConversationId(updatedList[0].id);
          } else {
            selectConversationId(null);
            setMessages([]);
            setNextCursorSeq(null);
            setError(null);
          }
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error("Failed to delete conversation:", err);
      setError(t("dashboard:chatWorkspace.deleteConversationFailed"));
    }
  };

  const startRename = (convId: string, title: string, e: MouseEvent) => {
    e.stopPropagation();
    setRenamingId(convId);
    setRenameValue(title);
  };

  const handlePlaceConversation = async (placement: ConversationPlacement) => {
    if (!selectedId || organizationRef.current || conversationCreationInFlightRef.current || !conversationsRef.current.some(c => c.id === placement.conversationId)) return;
    const request = {};
    organizationRef.current = request;
    const generation = instanceGenerationRef.current;
    const isCurrent = () => organizationRef.current === request && selectedIdRef.current === selectedId && instanceGenerationRef.current === generation;
    organizationRevisionRef.current += 1;
    listRequestRef.current += 1;
    setLoadingConversations(false);
    setLoadingMoreConversations(false);
    setOrganizingConversations(true);
    try {
      const res = await api.put(`/api/instances/${selectedId}/conversations/placement`, placement);
      if (!isCurrent()) return;
      if (!res?.success || !Array.isArray(res.conversations)) throw new Error("Invalid placement response");
      // The server returns the entire authorized order, including previously unloaded rows.
      // Discard the old cursor: ranks used by that cursor changed in this transaction.
      setConversations(res.conversations);
      setConversationsCursor(null);
    } catch (err) {
      if (!isCurrent()) return;
      console.error("Failed to place conversation:", err);
      setError(t("dashboard:chatWorkspace.reorderConversationFailed"));
    } finally {
      if (isCurrent()) { organizationRef.current = null; setOrganizingConversations(false); }
    }
  };

  const handleMoveConversation = async (convId: string, direction: "up" | "down", e: MouseEvent) => {
    e.stopPropagation();
    const source = conversationsRef.current.find(c => c.id === convId);
    if (!source) return;
    const siblings = conversationsRef.current.filter(c => Boolean(c.pinned_at) === Boolean(source.pinned_at) && (source.pinned_at || (c.project_id || null) === (source.project_id || null)));
    const index = siblings.findIndex(c => c.id === convId);
    const target = siblings[index + (direction === "up" ? -1 : 1)];
    if (!target) return;
    await handlePlaceConversation({ conversationId: convId, targetId: target.id, position: direction === "up" ? "before" : "after",
      section: source.pinned_at ? { kind: "pinned" } : source.project_id ? { kind: "project", projectId: source.project_id } : { kind: "recent" } });
  };

  const handleMoveProject = async (projectId: string, direction: "up" | "down", e: MouseEvent) => {
    e.stopPropagation();
    if (!selectedId) return;
    const snapshot = conversationProjects;
    const next = moveOrderedRecord(snapshot, projectId, direction);
    if (!next) return;
    const mutationId = ++projectOrderMutationRef.current;
    setConversationProjects(next);
    try {
      const res = await api.put('/api/instances/' + selectedId + '/conversation-projects/order', { orderedIds: next.map(project => project.id) });
      if (res?.success && Array.isArray(res.projects) && projectOrderMutationRef.current === mutationId) {
        setConversationProjects(current => mergePersistedOrder(current, res.projects, sortProjectRecords));
      }
    } catch (err) {
      console.error("Failed to persist project order:", err);
      if (projectOrderMutationRef.current === mutationId) {
        setConversationProjects(current => mergePersistedOrder(current, snapshot, sortProjectRecords));
      }
      setError(t("dashboard:chatWorkspace.reorderProjectFailed"));
    }
  };

  const handleTogglePinConversation = async (convId: string, e: MouseEvent) => {
    e.stopPropagation();
    const source = conversationsRef.current.find(c => c.id === convId);
    if (!source) return;
    await handlePlaceConversation({ conversationId: convId, targetId: null, position: "after",
      section: !source.pinned_at ? { kind: "pinned" } : source.project_id && conversationProjects.some(p => p.id === source.project_id)
        ? { kind: "project", projectId: source.project_id } : { kind: "recent" } });
  };

  const buildConversationTitleFromMessage = (content: string) => {
    return createConversationTitle(content, t("dashboard:chatWorkspace.newChat"));
  };

  const isDefaultConversationTitle = (title?: string | null) => {
    const normalized = (title || "").trim();
    if (!normalized) return true;
    const defaultNewChat = t("dashboard:chatWorkspace.newChat").trim();
    return normalized === defaultNewChat ||
      normalized.startsWith(`${defaultNewChat} `) ||
      /^新对话\s*\d*$/i.test(normalized) ||
      /^new chat\s*\d*$/i.test(normalized) ||
      /^untitled\s*\d*$/i.test(normalized);
  };

  const maybeRenameDefaultConversation = async (convId: string, content: string) => {
    if (!selectedId || !convId) return;
    const current = conversations.find(c => c.id === convId);
    if (!current || !isDefaultConversationTitle(current.title)) return;

    const nextTitle = buildConversationTitleFromMessage(content);
    if (!nextTitle || nextTitle === current.title) return;

    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: nextTitle } : c));
    try {
      const res = await api.patch(`/api/instances/${selectedId}/conversations/${convId}`, { title: nextTitle });
      if (res && res.success && res.conversation) {
        setConversations(prev => prev.map(c => c.id === convId ? res.conversation : c));
      }
    } catch (err) {
      console.warn("Failed to auto rename conversation:", err);
    }
  };

  const handleRenameSubmit = async (convId: string) => {
    if (!selectedId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      const res = await api.patch(`/api/instances/${selectedId}/conversations/${convId}`, {
        title: renameValue.trim()
      });
      if (res && res.success && res.conversation) {
        setConversations(prev => prev.map(c => c.id === convId ? res.conversation : c));
      }
    } catch (err) {
      console.error("Failed to rename conversation:", err);
    } finally {
      setRenamingId(null);
    }
  };

  const loadMoreConversations = async (instanceId: string) => {
    if (!conversationsCursor || loadingMoreConversations) return;
    const currentInstanceGen = instanceGenerationRef.current;
    const initialSelectedId = selectedId;

    const organizationRevision = organizationRevisionRef.current;
    try {
      setLoadingMoreConversations(true);
      const res = await api.get(`/api/instances/${instanceId}/conversations?limit=20&cursor=${conversationsCursor}`);
      if (organizationRevisionRef.current !== organizationRevision || selectedIdRef.current !== initialSelectedId || instanceGenerationRef.current !== currentInstanceGen) return;
      if (res && res.success && Array.isArray(res.conversations)) {
        setConversations(prev => [...prev, ...res.conversations]);
        setConversationsCursor(res.nextCursor);
      }
    } catch (err) {
      if (organizationRevisionRef.current !== organizationRevision || selectedIdRef.current !== initialSelectedId || instanceGenerationRef.current !== currentInstanceGen) return;
      console.error("Failed to load more conversations:", err);
    } finally {
      if (selectedIdRef.current === initialSelectedId && instanceGenerationRef.current === currentInstanceGen) {
        setLoadingMoreConversations(false);
      }
    }
  };

  const handleConversationsScroll = (e: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (!organizationRef.current && scrollHeight - scrollTop - clientHeight < 30 && conversationsCursor && !loadingMoreConversations && selectedId) {
      void loadMoreConversations(selectedId);
    }
  };

  return {
    creatingConversation,
    conversationCreationInFlightRef,
    conversations,
    conversationProjects,
    setConversations,
    loadingConversations,
    setConversationsCursor,
    loadingMoreConversations,
    renamingId,
    renameValue,
    setRenameValue,
    setRenamingId,
    resetConversationsForInstance,
    loadConversationsForSelectedInstance,
    loadConversationProjects,
    handleCreateConversation,
    handleCreateProject,
    handleRenameProject,
    handleDeleteProject,
    handleMoveConversationToProject,
    handleDeleteConversation,
    startRename,
    handlePlaceConversation,
    organizingConversations,
    handleMoveConversation,
    handleMoveProject,
    handleTogglePinConversation,
    buildConversationTitleFromMessage,
    maybeRenameDefaultConversation,
    handleRenameSubmit,
    handleConversationsScroll
  };
}
