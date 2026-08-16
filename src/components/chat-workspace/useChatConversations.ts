import { useState } from "react";
import type { Dispatch, MouseEvent, MutableRefObject, SetStateAction, UIEvent } from "react";
import type { TFunction } from "i18next";
import { api } from "../../lib/api";
import type { ChatMessage } from "../../lib/chatWorkspaceState";
import { shouldAcceptConversationHistory } from "../../lib/chatWorkspaceState";
import type { PendingAttachment } from "./ChatInputBar";

type ConversationRecord = any;
type ChatProjectRecord = any;

type ConversationPrefs = {
  orderedIds: string[];
  pinnedIds: string[];
};

const CONVERSATION_PREFS_PREFIX = "mybay.chatWorkspace.conversationPrefs.";

function safeTime(value: unknown) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

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
  selectedConversationId,
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

  const getConversationPrefsKey = () => `${CONVERSATION_PREFS_PREFIX}${selectedId || "none"}`;

  const readConversationPrefs = (): ConversationPrefs => {
    if (typeof window === "undefined") return { orderedIds: [], pinnedIds: [] };
    try {
      const raw = window.localStorage.getItem(getConversationPrefsKey());
      if (!raw) return { orderedIds: [], pinnedIds: [] };
      const parsed = JSON.parse(raw);
      return {
        orderedIds: Array.isArray(parsed?.orderedIds) ? parsed.orderedIds.filter((id: unknown) => typeof id === "string") : [],
        pinnedIds: Array.isArray(parsed?.pinnedIds) ? parsed.pinnedIds.filter((id: unknown) => typeof id === "string") : []
      };
    } catch {
      return { orderedIds: [], pinnedIds: [] };
    }
  };

  const writeConversationPrefs = (prefs: ConversationPrefs) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(getConversationPrefsKey(), JSON.stringify({
      orderedIds: Array.from(new Set(prefs.orderedIds)),
      pinnedIds: Array.from(new Set(prefs.pinnedIds))
    }));
  };

  const applyConversationPreferences = (items: ConversationRecord[]) => {
    const prefs = readConversationPrefs();
    const pinned = new Set([
      ...items.filter(item => Boolean(item.pinned_at)).map(item => item.id),
      ...prefs.pinnedIds
    ]);
    const order = new Map(prefs.orderedIds.map((id, index) => [id, index]));
    return [...items].map(item => ({
      ...item,
      pinned_at: pinned.has(item.id) ? (item.pinned_at || "local") : null
    })).sort((a, b) => {
      const pinnedA = pinned.has(a.id);
      const pinnedB = pinned.has(b.id);
      if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
      const orderA = order.has(a.id) ? order.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const orderB = order.has(b.id) ? order.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      const timeDiff = safeTime(b.updated_at) - safeTime(a.updated_at);
      if (timeDiff !== 0) return timeDiff;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
  };

  const setConversations: Dispatch<SetStateAction<ConversationRecord[]>> = (value) => {
    setConversationsRaw(prev => applyConversationPreferences(typeof value === "function" ? (value as (previous: ConversationRecord[]) => ConversationRecord[])(prev) : value));
  };

  const resetConversationsForInstance = () => {
    setConversations([]);
    setConversationProjects([]);
    setConversationsCursor(null);
    setLoadingMoreConversations(false);
  };

  const loadConversationProjects = async (instanceId: string) => {
    const res = await api.get('/api/instances/' + instanceId + '/conversation-projects');
    if (res && res.success && Array.isArray(res.projects)) {
      setConversationProjects(res.projects);
    }
  };

  const loadConversationsForSelectedInstance = async (initialSelectedId: string, currentInstanceGen: number) => {
    try {
      setLoadingConversations(true);
      const [projectsRes, res] = await Promise.all([
        api.get('/api/instances/' + selectedId + '/conversation-projects').catch(() => null),
        api.get('/api/instances/' + selectedId + '/conversations?limit=20')
      ]);
      if (!shouldAcceptConversationHistory(
        { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
        { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
      )) return;
      if (projectsRes && projectsRes.success && Array.isArray(projectsRes.projects)) {
        setConversationProjects(projectsRes.projects);
      }
      if (res && res.success && Array.isArray(res.conversations)) {
        const sortedConversations = applyConversationPreferences(res.conversations);
        setConversationsRaw(sortedConversations);
        setConversationsCursor(res.nextCursor);

        if (sortedConversations.length > 0) {
          const firstConv = sortedConversations[0];
          selectConversationId(firstConv.id);
        } else {
          selectConversationId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      if (shouldAcceptConversationHistory(
        { selectedId: selectedIdRef.current, instanceGeneration: instanceGenerationRef.current },
        { selectedId: initialSelectedId, instanceGeneration: currentInstanceGen }
      )) {
        setLoadingConversations(false);
      }
    }
  };

  const handleCreateConversation = async () => {
    if (!selectedId) return;
    try {
      const count = conversations.length + 1;
      const title = t("dashboard:chatWorkspace.newChatName", { count });
      const res = await api.post(`/api/instances/${selectedId}/conversations`, { title });
      if (res && res.success && res.conversation) {
        setPendingAttachments([]);
        setConversationFiles([]);
        setConversations(prev => [res.conversation, ...prev]);
        selectConversationId(res.conversation.id);
        setMessages([]);
        setNextCursorSeq(null);
        setError(null);
      }
    } catch (err: any) {
      console.error("Failed to create conversation:", err);
      setError(t("dashboard:chatWorkspace.createConversationFailed"));
    }
  };

  const handleCreateProject = async (name: string) => {
    if (!selectedId) return;
    const projectName = (name || "").trim();
    if (!projectName) return;

    try {
      const res = await api.post('/api/instances/' + selectedId + '/conversation-projects', { name: projectName });
      if (res && res.success && res.project) {
        setConversationProjects(prev => [res.project, ...prev]);
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
        setConversationProjects(prev => prev.map(project => project.id === projectId ? res.project : project));
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
    if (!selectedId) return;

    try {
      const res = await api.patch('/api/instances/' + selectedId + '/conversations/' + convId, { projectId });
      if (res && res.success && res.conversation) {
        setConversations(prev => prev.map(c => c.id === convId ? res.conversation : c));
      }
    } catch (err) {
      console.error("Failed to move conversation to project:", err);
      setError(t("dashboard:chatWorkspace.moveToProjectFailed"));
    }
  };

  const handleDeleteConversation = async (convId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!selectedId) return;

    const confirmed = await showConfirm({
      title: t("dashboard:chatWorkspace.deleteChat"),
      message: t("dashboard:chatWorkspace.deleteChatConfirm"),
      type: "danger",
      confirmText: t("dashboard:chatWorkspace.confirm"),
      cancelText: t("dashboard:chatWorkspace.cancel")
    });
    if (!confirmed) return;

    try {
      const res = await api.delete(`/api/instances/${selectedId}/conversations/${convId}`);
      if (res && res.success) {
        const updatedList = conversations.filter(c => c.id !== convId);
        setConversations(updatedList);
        if (selectedConversationId === convId) {
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
      console.error("Failed to delete conversation:", err);
      setError(t("dashboard:chatWorkspace.deleteConversationFailed"));
    }
  };

  const startRename = (convId: string, title: string, e: MouseEvent) => {
    e.stopPropagation();
    setRenamingId(convId);
    setRenameValue(title);
  };

  const handleMoveConversation = (convId: string, direction: "up" | "down", e: MouseEvent) => {
    e.stopPropagation();
    const current = [...conversations];
    const index = current.findIndex(c => c.id === convId);
    if (index < 0) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;
    const next = [...current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const prefs = readConversationPrefs();
    writeConversationPrefs({
      ...prefs,
      orderedIds: next.map(c => c.id)
    });
    setConversationsRaw(next);
  };

  const handleTogglePinConversation = (convId: string, e: MouseEvent) => {
    e.stopPropagation();
    const prefs = readConversationPrefs();
    const pinned = new Set([
      ...conversations.filter(c => Boolean(c.pinned_at)).map(c => c.id),
      ...prefs.pinnedIds
    ]);
    if (pinned.has(convId)) {
      pinned.delete(convId);
    } else {
      pinned.add(convId);
    }
    const orderedIds = [convId, ...prefs.orderedIds.filter(id => id !== convId)];
    writeConversationPrefs({ orderedIds, pinnedIds: Array.from(pinned) });
    setConversationsRaw(prev => applyConversationPreferences(prev.map(c => ({
      ...c,
      pinned_at: pinned.has(c.id) ? (c.pinned_at || "local") : null
    }))));

    if (selectedId) {
      void api.patch('/api/instances/' + selectedId + '/conversations/' + convId, { pinned: pinned.has(convId) })
        .then((res) => {
          if (res && res.success && res.conversation) {
            setConversations(prev => prev.map(c => c.id === convId ? res.conversation : c));
          }
        })
        .catch((err) => console.warn("Failed to persist conversation pin state:", err));
    }
  };

  const buildConversationTitleFromMessage = (content: string) => {
    const compact = content.replace(/\s+/g, " ").trim();
    if (!compact) return t("dashboard:chatWorkspace.newChat");
    return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
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

    try {
      setLoadingMoreConversations(true);
      const res = await api.get(`/api/instances/${instanceId}/conversations?limit=20&cursor=${conversationsCursor}`);
      if (selectedIdRef.current !== initialSelectedId || instanceGenerationRef.current !== currentInstanceGen) return;
      if (res && res.success && Array.isArray(res.conversations)) {
        setConversations(prev => [...prev, ...res.conversations]);
        setConversationsCursor(res.nextCursor);
      }
    } catch (err) {
      console.error("Failed to load more conversations:", err);
    } finally {
      if (selectedIdRef.current === initialSelectedId && instanceGenerationRef.current === currentInstanceGen) {
        setLoadingMoreConversations(false);
      }
    }
  };

  const handleConversationsScroll = (e: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 30 && conversationsCursor && !loadingMoreConversations && selectedId) {
      void loadMoreConversations(selectedId);
    }
  };

  return {
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
    handleMoveConversation,
    handleTogglePinConversation,
    buildConversationTitleFromMessage,
    maybeRenameDefaultConversation,
    handleRenameSubmit,
    handleConversationsScroll
  };
}
