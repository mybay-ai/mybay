import type { ConversationPlacement, ConversationSection } from "../../../shared/localConversationPlacement";
import { useConversationSidebarDrag } from "./useConversationSidebarDrag";
import { useSidebarCollapsedGroups } from "./useSidebarCollapsedGroups";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronLeft, Edit3, Folder, FolderOpen, GripVertical, FolderInput, FolderPlus, LoaderCircle, MessageSquare, MoreHorizontal, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConversationTitle } from "./ConversationTitle";
import { ConversationActionsDialog } from "./ConversationActionsDialog";
import { useConversationSearch } from "./useConversationSearch";
import { SearchHighlight } from "./SearchHighlight";
import type { ConversationSearchResult } from "../../../shared/conversationSearch";
export type { ConversationSearchResult } from "../../../shared/conversationSearch";



interface ChatConversationSidebarProps {
  mobileSidebarOpen: boolean;
  sidebarOpen: boolean;
  selectedId: string;
  loadingConversations: boolean;
  creatingConversation?: boolean;
  conversations: any[];
  conversationProjects: any[];
  selectedConversationId: string | null;
  renamingId: string | null;
  renameValue: string;
  loadingMoreConversations: boolean;
  onCreateConversation: (projectId?: string | null) => void;
  onPlaceConversation: (placement: ConversationPlacement) => void;
  organizingConversations?: boolean;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onMoveProject: (id: string, direction: "up" | "down", event: React.MouseEvent) => void;
  onCloseSidebar: () => void;
  onCloseMobileSidebar: () => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onSelectConversation: (id: string) => void;
  onSelectSearchResult: (result: ConversationSearchResult) => void;
  setRenameValue: (value: string) => void;
  setRenamingId: (id: string | null) => void;
  onRenameSubmit: (id: string) => void;
  onStartRename: (id: string, title: string, event: React.MouseEvent) => void;
  onMoveConversation: (id: string, direction: "up" | "down", event: React.MouseEvent) => void;
  onMoveConversationToProject: (id: string, projectId: string | null) => void;
  onTogglePinConversation: (id: string, event: React.MouseEvent) => void;
  onDeleteConversation: (id: string, event: React.MouseEvent) => void;
}

export function ChatConversationSidebar({
  mobileSidebarOpen,
  sidebarOpen,
  selectedId,
  loadingConversations,
  creatingConversation = false,
  conversations,
  conversationProjects,
  selectedConversationId,
  renamingId,
  renameValue,
  loadingMoreConversations,
  onCreateConversation,
  onPlaceConversation,
  organizingConversations = false,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onMoveProject,
  onCloseSidebar,
  onCloseMobileSidebar,
  onScroll,
  onSelectConversation,
  onSelectSearchResult,
  setRenameValue,
  setRenamingId,
  onRenameSubmit,
  onStartRename,
  onMoveConversation,
  onMoveConversationToProject,
  onTogglePinConversation,
  onDeleteConversation
}: ChatConversationSidebarProps) {
  const { t } = useTranslation("dashboard");
  const [projectModalMode, setProjectModalMode] = useState<"create" | "rename" | null>(null);
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [projectName, setProjectName] = useState("");
  const [moveConversationId, setMoveConversationId] = useState<string | null>(null);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [projectActionsId, setProjectActionsId] = useState<string | null>(null);
  const collapsed = useSidebarCollapsedGroups(selectedId);
  const drag = useConversationSidebarDrag(selectedId, organizingConversations || creatingConversation || Boolean(renamingId), onPlaceConversation, collapsed.expand);
  const projectActions = conversationProjects.find(project => project.id === projectActionsId);
  const renameFinishedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState("");
  const search = useConversationSearch(selectedId, searchQuery);
  const { results: searchResults, loading: searching, failed: searchFailed } = search;

  const moveConversation = useMemo(() => conversations.find((conv) => conv.id === moveConversationId) || null, [conversations, moveConversationId]);

  useEffect(() => {
    if (projectModalMode === "create") {
      setProjectName("");
      setEditingProject(null);
    }
  }, [projectModalMode]);

  useEffect(() => {
    setActionsId(null);
    setProjectActionsId(null);
    setSearchQuery("");

  }, [selectedId]);

  const closeProjectModal = () => {
    setProjectModalMode(null);
    setEditingProject(null);
    setProjectName("");
  };

  const openCreateProjectModal = () => {
    setProjectModalMode("create");
    setProjectName("");
    setEditingProject(null);
  };

  const openRenameProjectModal = (project: any) => {
    setProjectModalMode("rename");
    setEditingProject(project);
    setProjectName(project.name || "");
  };

  const submitProjectModal = () => {
    const name = projectName.trim();
    if (!name) return;
    if (projectModalMode === "rename" && editingProject?.id) {
      onRenameProject(editingProject.id, name);
    } else {
      onCreateProject(name);
    }
    closeProjectModal();
  };

  const closeMoveModal = () => setMoveConversationId(null);

  const submitMoveToProject = (projectId: string | null) => {
    if (!moveConversationId) return;
    onMoveConversationToProject(moveConversationId, projectId);
    closeMoveModal();
  };

  const pinnedConversations = conversations.filter((conv) => Boolean(conv.pinned_at));
  const projectConversationIds = new Set<string>();
  const projectGroups = conversationProjects.map((project) => {
    const items = conversations.filter((conv) => {
      const matched = conv.project_id === project.id && !conv.pinned_at;
      if (matched) projectConversationIds.add(conv.id);
      return matched;
    });
    return { project, items };
  });
  const recentConversations = conversations.filter((conv) => !conv.pinned_at && !projectConversationIds.has(conv.id));
  const hasAnyConversation = conversations.length > 0;

  const renderSectionTitle = (key: string, label: string, count: number, icon?: React.ReactNode) => (
    <button type="button" onClick={() => collapsed.toggle(key)} aria-expanded={!collapsed.isCollapsed(key)}
      aria-label={label} onDragEnter={() => { if (drag.draggedId && key === "projects") collapsed.expand(key); }}
      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-[12px] font-semibold text-content-muted hover:bg-surface-muted focus-visible:outline focus-visible:outline-indigo-500">
      {collapsed.isCollapsed(key) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {icon}<span className="flex-1">{label}</span><span title={t("chatWorkspace.loadedGroupCount")} className="rounded-md bg-surface-muted px-1.5 text-[10px] tabular-nums">{count}</span>
    </button>
  );
  const dropClass = (key: string) => drag.over?.key === key ? "ring-2 ring-indigo-500/60 bg-indigo-500/10" : "";
  const emptyDrop = (key: string) => <div className="rounded-lg border border-dashed border-outline px-3 py-3 text-center text-[11px] leading-5 text-content-muted">{t(key)}</div>;

  const renderConversation = (conv: any) => {
    const isSelected = conv.id === selectedConversationId;
    const isRenaming = conv.id === renamingId;
    const isPinned = Boolean(conv.pinned_at);
    const sectionItems = isPinned
      ? pinnedConversations
      : conv.project_id
        ? conversations.filter((item) => !item.pinned_at && item.project_id === conv.project_id)
        : recentConversations;
    const section: ConversationSection = isPinned ? { kind: "pinned" } : conv.project_id && projectGroups.some(group => group.project.id === conv.project_id) ? { kind: "project", projectId: conv.project_id } : { kind: "recent" };
    const sectionIndex = sectionItems.findIndex((item) => item.id === conv.id);

    return (
      <div
        key={conv.id}
        data-conversation-title-row
        draggable={!isRenaming && !organizingConversations && !creatingConversation}
        onDragStart={event => drag.start(event, conv.id)} onDragEnd={drag.reset}
        {...drag.targetProps(section, conv.id)}
        className={`group relative ${drag.draggedId === conv.id ? "opacity-40" : ""} p-1 rounded-xl flex items-center gap-1 transition-all select-none border ${
          isSelected
            ? "bg-white text-slate-950 font-semibold border-indigo-200 shadow-sm dark:bg-indigo-500/15 max-sm:dark:bg-indigo-500/20 dark:text-indigo-100 dark:border-indigo-400/35"
            : "bg-surface/55 text-content-secondary hover:bg-surface hover:border-outline-strong border-transparent max-sm:dark:bg-slate-900/70 dark:border-slate-800/70"
        }`}
      >
        {drag.over?.key === conv.id && <span className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 bg-indigo-500 ${drag.over.position === "before" ? "-top-1" : "-bottom-1"}`} />}
        {!isRenaming && <button type="button" draggable={false} disabled={organizingConversations || creatingConversation}
          aria-label={`${t("chatWorkspace.dragConversation")}: ${conv.title}`} title={t("chatWorkspace.dragConversation")}
          onPointerDown={event => drag.pointerStart(event, conv.id)} onPointerMove={drag.pointerMove} onPointerUp={drag.pointerEnd}
          onPointerCancel={drag.reset} onLostPointerCapture={drag.reset}
          onClick={event => { event.preventDefault(); event.stopPropagation(); }}
          className="relative flex h-8 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded text-content-muted active:cursor-grabbing focus-visible:outline focus-visible:outline-indigo-500">
          {isPinned ? <Pin className="h-3.5 w-3.5 text-indigo-500 group-hover:opacity-0" /> : <MessageSquare className="h-3.5 w-3.5 group-hover:opacity-0" />}
          <GripVertical className="absolute h-4 w-4 opacity-0 group-hover:opacity-100" />
        </button>}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label={t("chatWorkspace.renameChat")}
            maxLength={100}
            onBlur={() => { if (!renameFinishedRef.current) { renameFinishedRef.current = true; onRenameSubmit(conv.id); } }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !renameFinishedRef.current) { e.preventDefault(); renameFinishedRef.current = true; onRenameSubmit(conv.id); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); renameFinishedRef.current = true; setRenamingId(null); }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 m-1.5 bg-surface border border-outline-strong rounded text-[13px] px-1.5 py-0.5 text-content outline-none focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <button type="button" data-conversation-title-trigger aria-current={isSelected ? "true" : undefined}
            onClick={() => { if (!drag.draggedId) onSelectConversation(conv.id); }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left text-[13px] leading-relaxed focus-visible:outline focus-visible:outline-indigo-500">

            <span className="min-w-0 flex-1"><ConversationTitle title={conv.title} disabled={actionsId !== null || Boolean(drag.draggedId)} /></span>
          </button>
        )}

        {!isRenaming && (
          <>
            <button type="button" disabled={organizingConversations} draggable={false} aria-haspopup="dialog" aria-label={`${t("chatWorkspace.conversationActions")}: ${conv.title}`}
              title={t("chatWorkspace.conversationActions")} onClick={() => setActionsId(conv.id)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-content-muted hover:bg-surface-muted hover:text-content focus-visible:outline focus-visible:outline-indigo-500">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {actionsId === conv.id && <ConversationActionsDialog title={conv.title} label={t("chatWorkspace.conversationActions")} closeLabel={t("chatWorkspace.cancel")} onClose={() => setActionsId(null)}>
              <button type="button" onClick={event => { setActionsId(null); onTogglePinConversation(conv.id, event); }}><Pin className="h-4 w-4" />{t(isPinned ? "chatWorkspace.unpinChat" : "chatWorkspace.pinChat")}</button>
              <button type="button" disabled={sectionIndex <= 0} onClick={event => { setActionsId(null); onMoveConversation(conv.id, "up", event); }}><ArrowUp className="h-4 w-4" />{t("chatWorkspace.moveChatUp")}</button>
              <button type="button" disabled={sectionIndex < 0 || sectionIndex >= sectionItems.length - 1} onClick={event => { setActionsId(null); onMoveConversation(conv.id, "down", event); }}><ArrowDown className="h-4 w-4" />{t("chatWorkspace.moveChatDown")}</button>
              <button type="button" onClick={() => { setActionsId(null); setMoveConversationId(conv.id); }}><FolderInput className="h-4 w-4" />{t("chatWorkspace.moveToProject")}</button>
              <button type="button" onClick={event => { setActionsId(null); renameFinishedRef.current = false; onStartRename(conv.id, conv.title, event); }}><Edit3 className="h-4 w-4" />{t("chatWorkspace.renameChat")}</button>
              <button type="button" className="text-red-600 dark:text-red-300" onClick={event => { setActionsId(null); onDeleteConversation(conv.id, event); }}><Trash2 className="h-4 w-4" />{t("chatWorkspace.deleteChat")}</button>
            </ConversationActionsDialog>}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      className={`absolute inset-y-0 left-0 z-30 w-[min(82vw,280px)] bg-surface border-r border-slate-200 dark:border-slate-800 shrink-0 transition-transform md:transition-all duration-300 flex flex-col ${
        mobileSidebarOpen ? "translate-x-0 shadow-xl max-md:shadow-2xl max-md:shadow-slate-950/40" : "-translate-x-full"
      } md:relative md:inset-auto md:translate-x-0 md:shadow-none ${
        sidebarOpen ? "md:w-[292px]" : "md:w-0 md:overflow-hidden md:border-r-0"
      }`}
    >
      <div className="p-3 border-b border-outline bg-surface/70 max-sm:dark:bg-slate-950 shrink-0 flex items-center gap-2">
        <button
          onClick={() => onCreateConversation()}
          className="flex-1 h-9 px-3.5 bg-slate-950 hover:bg-slate-800 text-white text-[13px] font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shadow-xs dark:bg-indigo-600 dark:hover:bg-indigo-500"
          title={t("chatWorkspace.newChat")}
          disabled={!selectedId || creatingConversation || organizingConversations}
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>{t(creatingConversation ? "chatWorkspace.creatingConversation" : "chatWorkspace.newChat")}</span>
        </button>
        <button
          onClick={openCreateProjectModal}
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-outline bg-surface text-content-muted hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 disabled:opacity-50 dark:hover:text-indigo-300 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-950/30"
          title={t("chatWorkspace.createProject")}
          disabled={!selectedId}
        >
          <FolderPlus className="w-4 h-4" />
        </button>
        <button
          onClick={onCloseSidebar}
          className="p-2 text-content-muted hover:text-content-secondary rounded-lg hidden md:block hover:bg-surface-muted"
          title={t("chatWorkspace.sidebarToggle")}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCloseMobileSidebar}
          className="p-2 text-content-muted hover:text-content-secondary rounded-lg md:hidden hover:bg-surface-muted"
          title={t("chatWorkspace.sidebarToggle")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="shrink-0 border-b border-outline bg-surface/55 px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            maxLength={200}
            placeholder={t("chatWorkspace.searchConversations")}
            className="h-9 w-full rounded-lg border border-outline bg-surface pl-9 pr-8 text-[13px] text-content outline-none transition placeholder:text-content-muted focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-content-muted hover:bg-surface-muted hover:text-content-secondary" title={t("chatWorkspace.clearSearch")}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div ref={drag.scrollRef} onDragOverCapture={drag.scroll} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) drag.stopScroll(); }} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-1.5 [-webkit-overflow-scrolling:touch]" onScroll={event => { if (searchQuery.trim().length < 2) onScroll(event); }}>
        {searchQuery.trim().length >= 2 ? (
          searching ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-content-muted"><LoaderCircle className="h-4 w-4 animate-spin" />{t("chatWorkspace.searchingConversations")}</div>
          ) : searchFailed ? (
            <div className="px-4 py-10 text-center text-[13px] text-red-600 dark:text-red-300"><p role="status">{t("chatWorkspace.searchConversationsFailed")}</p><button type="button" onClick={search.retry} className="mt-2 rounded px-3 py-1 underline">{t("chatWorkspace.retrySearch")}</button></div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-content-muted">{t("chatWorkspace.noConversationSearchResults")}</div>
          ) : (
            <div className="space-y-1.5">
              <div className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-content-muted">{t("chatWorkspace.searchResults", { count: searchResults.length })}</div>
              {searchResults.map((result, index) => (
                <button
                  type="button"
                  key={`${result.conversation_id}-${result.message_id || "title"}-${index}`}
                  data-conversation-title-trigger
                  onClick={() => onSelectSearchResult(result)}
                  className="w-full rounded-xl border border-transparent bg-surface/55 p-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50 dark:hover:border-indigo-500/35 dark:hover:bg-indigo-950/30"
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                    <span className="min-w-0 flex-1 text-[13px] font-semibold text-content"><ConversationTitle title={result.conversation_title}><SearchHighlight text={result.conversation_title} query={searchQuery} /></ConversationTitle></span>
                    <span className="shrink-0 text-[10px] text-content-muted">{t(result.matched_field === "title" ? "chatWorkspace.titleMatch" : "chatWorkspace.messageMatch")}</span>
                  </div>
                  {result.matched_field === "message" && <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-content-muted">{<SearchHighlight text={result.snippet} query={searchQuery} />}</p>}
                </button>
              ))}
              {search.moreFailed && <p role="status" className="px-2 text-xs text-red-600 dark:text-red-300">{t("chatWorkspace.searchConversationsFailed")}</p>}
              {search.nextCursor && <button type="button" disabled={search.loadingMore} onClick={() => void search.loadMore()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-outline px-3 py-2 text-xs text-content-secondary disabled:opacity-50">
                {search.loadingMore && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{t(search.moreFailed ? "chatWorkspace.retrySearch" : "chatWorkspace.loadMoreSearchResults")}
              </button>}
            </div>
          )
        ) : loadingConversations ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 bg-surface/70 rounded-lg animate-pulse border border-outline/70" />
            ))}
          </div>
        ) : !hasAnyConversation && projectGroups.length === 0 ? (
          <div className="text-center py-8 px-4 text-content-muted text-[13px]">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p>{t("chatWorkspace.emptyHistory")}</p>
            <p className="text-[11px] text-content-muted mt-1">{t("chatWorkspace.emptyHistoryDesc")}</p>
          </div>
        ) : (
          <>
            <section aria-label={t("chatWorkspace.pinnedChats")} {...drag.targetProps({ kind: "pinned" })} className={`rounded-xl p-1 ${dropClass("pinned")}`}>
              {renderSectionTitle("pinned", t("chatWorkspace.pinnedChats"), pinnedConversations.length, <Pin className="h-3.5 w-3.5" />)}
              {!collapsed.isCollapsed("pinned") && <div className="space-y-1.5">{pinnedConversations.length ? pinnedConversations.map(renderConversation) : emptyDrop("chatWorkspace.dropToPinned")}</div>}
            </section>
            <section aria-label={t("chatWorkspace.projects")} className="rounded-xl p-1">
              {renderSectionTitle("projects", t("chatWorkspace.projects"), projectGroups.length, <Folder className="h-3.5 w-3.5" />)}
              {!collapsed.isCollapsed("projects") && <div className="space-y-2">
                {projectGroups.map(({ project, items }) => {
                  const key = `project:${project.id}`;
                  const closed = collapsed.isCollapsed(key);
                  return <div key={project.id} {...drag.targetProps({ kind: "project", projectId: project.id })} className={`rounded-xl border border-outline/70 p-1 ${dropClass(key)}`}>
                    <div className="group/project flex items-center gap-1">
                      <button type="button" onClick={() => collapsed.toggle(key)} aria-expanded={!closed} title={project.name}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-2 text-left text-[13px] font-semibold text-content-secondary hover:bg-surface-muted focus-visible:outline focus-visible:outline-indigo-500">
                        {closed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                        {closed ? <Folder className="h-4 w-4 shrink-0" /> : <FolderOpen className="h-4 w-4 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate">{project.name}</span><span title={t("chatWorkspace.loadedGroupCount")} className="text-[10px] text-content-muted">{items.length}</span>
                      </button>
                      <button type="button" disabled={creatingConversation || organizingConversations} aria-label={`${t("chatWorkspace.newChatInProject")}: ${project.name}`} title={t("chatWorkspace.newChatInProject")}
                        onClick={() => { collapsed.expand(key); onCreateConversation(project.id); }} className="rounded-lg p-1.5 text-content-muted hover:bg-surface-muted"><Plus className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={organizingConversations} aria-haspopup="dialog" aria-label={`${t("chatWorkspace.projectActions")}: ${project.name}`} onClick={() => setProjectActionsId(project.id)} className="rounded-lg p-1.5 text-content-muted hover:bg-surface-muted"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                    </div>
                    {!closed && <div className="space-y-1.5">{items.length ? items.map(renderConversation) : emptyDrop("chatWorkspace.dropToProject")}</div>}
                  </div>;
                })}
                {projectGroups.length === 0 && <button type="button" onClick={openCreateProjectModal} className="w-full rounded-xl border border-dashed border-outline px-3 py-3 text-[12px] text-content-muted hover:bg-surface-muted">{t("chatWorkspace.createProject")}</button>}
              </div>}
            </section>
            <section aria-label={t("chatWorkspace.recentChats")} {...drag.targetProps({ kind: "recent" })} className={`rounded-xl p-1 ${dropClass("recent")}`}>
              {renderSectionTitle("recent", t("chatWorkspace.recentChats"), recentConversations.length, <MessageSquare className="h-3.5 w-3.5" />)}
              {!collapsed.isCollapsed("recent") && <div className="space-y-1.5">{recentConversations.length ? recentConversations.map(renderConversation) : emptyDrop("chatWorkspace.dropToRecent")}</div>}
            </section>
          </>
        )}

        {loadingMoreConversations && (
          <div className="py-2 text-center text-[11px] text-content-muted animate-pulse">
            {t("chatWorkspace.loadingMore")}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite" className="shrink-0 border-t border-outline px-3 py-2 text-[11px] leading-5 text-content-muted">{t(organizingConversations ? "chatWorkspace.savingConversationOrder" : "chatWorkspace.dragConversationHint")}</div>
      {projectActions && <ConversationActionsDialog title={projectActions.name} label={t("chatWorkspace.projectActions")} closeLabel={t("chatWorkspace.cancel")} onClose={() => setProjectActionsId(null)}>
        <button type="button" disabled={creatingConversation} onClick={() => { setProjectActionsId(null); collapsed.expand(`project:${projectActions.id}`); onCreateConversation(projectActions.id); }}><Plus className="h-4 w-4" />{t("chatWorkspace.newChatInProject")}</button>
        <button type="button" disabled={conversationProjects[0]?.id === projectActions.id} onClick={event => { setProjectActionsId(null); onMoveProject(projectActions.id, "up", event); }}><ArrowUp className="h-4 w-4" />{t("chatWorkspace.moveProjectUp")}</button>
        <button type="button" disabled={conversationProjects.at(-1)?.id === projectActions.id} onClick={event => { setProjectActionsId(null); onMoveProject(projectActions.id, "down", event); }}><ArrowDown className="h-4 w-4" />{t("chatWorkspace.moveProjectDown")}</button>
        <button type="button" onClick={() => { setProjectActionsId(null); openRenameProjectModal(projectActions); }}><Edit3 className="h-4 w-4" />{t("chatWorkspace.renameProject")}</button>
        <button type="button" className="text-red-600 dark:text-red-300" onClick={() => { setProjectActionsId(null); onDeleteProject(projectActions.id); }}><Trash2 className="h-4 w-4" />{t("chatWorkspace.deleteProject")}</button>
      </ConversationActionsDialog>}
      {projectModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm" onMouseDown={closeProjectModal}>
          <div className="w-full max-w-md rounded-2xl border border-outline bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-content">{projectModalMode === "rename" ? t("chatWorkspace.renameProject") : t("chatWorkspace.createProject")}</h3>
                <p className="mt-1 text-[13px] text-content-muted">{t("chatWorkspace.projectModalDesc")}</p>
              </div>
              <button type="button" onClick={closeProjectModal} className="rounded-lg p-1.5 text-slate-400 hover:bg-surface-muted hover:text-content-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-1.5 block text-[12px] font-semibold text-content-muted">{t("chatWorkspace.projectName")}</label>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitProjectModal();
                if (event.key === "Escape") closeProjectModal();
              }}
              autoFocus
              maxLength={100}
              className="h-10 w-full rounded-xl border border-outline bg-surface px-3 text-[14px] text-content outline-none transition focus:border-indigo-400 focus:ring-3 focus:ring-indigo-100 dark:focus:border-indigo-500 dark:focus:ring-indigo-500/20"
              placeholder={t("chatWorkspace.projectNamePlaceholder")}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeProjectModal} className="rounded-lg border border-outline px-4 py-2 text-[13px] font-semibold text-content-secondary hover:bg-surface-muted">{t("chatWorkspace.cancel")}</button>
              <button type="button" onClick={submitProjectModal} disabled={!projectName.trim()} className="rounded-lg bg-slate-950 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-600 dark:hover:bg-indigo-500">{projectModalMode === "rename" ? t("chatWorkspace.saveProject") : t("chatWorkspace.createProject")}</button>
            </div>
          </div>
        </div>
      )}

      {moveConversationId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm" onMouseDown={closeMoveModal}>
          <div className="w-full max-w-md rounded-2xl border border-outline bg-surface p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-content">{t("chatWorkspace.moveToProject")}</h3>
                <p className="mt-1 line-clamp-2 text-[13px] text-content-muted">{moveConversation?.title}</p>
              </div>
              <button type="button" onClick={closeMoveModal} className="rounded-lg p-1.5 text-slate-400 hover:bg-surface-muted hover:text-content-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <button type="button" onClick={() => submitMoveToProject(null)} className="flex w-full items-center gap-3 rounded-xl border border-outline bg-surface-muted px-3 py-2.5 text-left text-[13px] font-semibold text-content-secondary hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-200">
                <MessageSquare className="h-4 w-4 text-slate-400" />
                <span>{t("chatWorkspace.recentChats")}</span>
              </button>
              {conversationProjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-outline px-3 py-6 text-center text-[13px] text-content-muted">{t("chatWorkspace.noProjectsForMove")}</div>
              ) : conversationProjects.map((project) => (
                <button key={project.id} type="button" onClick={() => submitMoveToProject(project.id)} className="flex w-full items-center gap-3 rounded-xl border border-outline bg-surface px-3 py-2.5 text-left text-[13px] font-semibold text-content-secondary hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-200">
                  <Folder className="h-4 w-4 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={closeMoveModal} className="rounded-lg border border-outline px-4 py-2 text-[13px] font-semibold text-content-secondary hover:bg-surface-muted">{t("chatWorkspace.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
