import { ArrowDown, ArrowUp, ChevronLeft, Edit3, Folder, FolderInput, FolderPlus, MessageSquare, Pin, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface ChatConversationSidebarProps {
  mobileSidebarOpen: boolean;
  sidebarOpen: boolean;
  selectedId: string;
  loadingConversations: boolean;
  conversations: any[];
  conversationProjects: any[];
  selectedConversationId: string | null;
  renamingId: string | null;
  renameValue: string;
  loadingMoreConversations: boolean;
  onCreateConversation: () => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onMoveProject: (id: string, direction: "up" | "down", event: React.MouseEvent) => void;
  onCloseSidebar: () => void;
  onCloseMobileSidebar: () => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onSelectConversation: (id: string) => void;
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
  conversations,
  conversationProjects,
  selectedConversationId,
  renamingId,
  renameValue,
  loadingMoreConversations,
  onCreateConversation,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onMoveProject,
  onCloseSidebar,
  onCloseMobileSidebar,
  onScroll,
  onSelectConversation,
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

  const moveConversation = useMemo(() => conversations.find((conv) => conv.id === moveConversationId) || null, [conversations, moveConversationId]);

  useEffect(() => {
    if (projectModalMode === "create") {
      setProjectName("");
      setEditingProject(null);
    }
  }, [projectModalMode]);

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

  const renderSectionTitle = (label: string, icon?: React.ReactNode) => (
    <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
      {icon}
      <span>{label}</span>
    </div>
  );

  const renderConversation = (conv: any) => {
    const isSelected = conv.id === selectedConversationId;
    const isRenaming = conv.id === renamingId;
    const isPinned = Boolean(conv.pinned_at);
    const sectionItems = isPinned
      ? pinnedConversations
      : conv.project_id
        ? conversations.filter((item) => !item.pinned_at && item.project_id === conv.project_id)
        : recentConversations;
    const sectionIndex = sectionItems.findIndex((item) => item.id === conv.id);

    return (
      <div
        key={conv.id}
        onClick={() => {
          if (!isRenaming) onSelectConversation(conv.id);
        }}
        className={`group relative p-2.5 pr-[10.5rem] rounded-xl flex items-center gap-2.5 cursor-pointer transition-all select-none border ${
          isSelected
            ? "bg-white text-slate-950 font-semibold border-indigo-200 shadow-sm dark:bg-indigo-500/15 max-sm:dark:bg-indigo-500/20 dark:text-indigo-100 dark:border-indigo-400/35"
            : "bg-surface/55 text-content-secondary hover:bg-surface hover:border-outline-strong border-transparent max-sm:dark:bg-slate-900/70 dark:border-slate-800/70"
        }`}
      >
        <MessageSquare className={`w-4 h-4 shrink-0 ${isSelected ? "text-indigo-600 dark:text-indigo-300" : "text-content-muted"}`} />

        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => onRenameSubmit(conv.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit(conv.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-surface border border-outline-strong rounded text-[13px] px-1.5 py-0.5 text-content outline-none focus:ring-1 focus:ring-indigo-500"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-left leading-relaxed">{conv.title}</span>
        )}

        {!isRenaming && (
          <div className="absolute right-2 top-1/2 flex h-7 w-40 -translate-y-1/2 items-center justify-end gap-1 rounded-lg bg-surface/95 opacity-100 shadow-[0_0_10px_rgba(255,255,255,0.9)] transition-opacity sm:opacity-0 sm:group-hover:opacity-100 dark:shadow-[0_0_10px_rgba(15,23,42,0.9)]">
            <button
              onClick={(event) => onTogglePinConversation(conv.id, event)}
              className={`p-1 rounded ${isPinned ? "text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40" : "text-content-muted hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/40"}`}
              title={isPinned ? t("chatWorkspace.unpinChat") : t("chatWorkspace.pinChat")}
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => onMoveConversation(conv.id, "up", event)}
              disabled={sectionIndex <= 0}
              className="p-1 text-content-muted hover:text-content-secondary hover:bg-outline/50 rounded disabled:cursor-not-allowed disabled:opacity-30"
              title={t("chatWorkspace.moveChatUp")}
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => onMoveConversation(conv.id, "down", event)}
              disabled={sectionIndex < 0 || sectionIndex >= sectionItems.length - 1}
              className="p-1 text-content-muted hover:text-content-secondary hover:bg-outline/50 rounded disabled:cursor-not-allowed disabled:opacity-30"
              title={t("chatWorkspace.moveChatDown")}
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => { event.stopPropagation(); setMoveConversationId(conv.id); }}
              className="p-1 text-content-muted hover:text-indigo-600 hover:bg-indigo-50 rounded dark:hover:text-indigo-300 dark:hover:bg-indigo-950/40"
              title={t("chatWorkspace.moveToProject")}
            >
              <FolderInput className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => onStartRename(conv.id, conv.title, event)}
              className="p-1 text-content-muted hover:text-content-secondary hover:bg-outline/50 rounded"
              title={t("chatWorkspace.renameChat")}
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => onDeleteConversation(conv.id, event)}
              className="p-1 text-content-muted hover:text-red-600 hover:bg-red-50 rounded dark:hover:text-red-300 dark:hover:bg-red-950/40"
              title={t("chatWorkspace.deleteChat")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`absolute inset-y-0 left-0 z-30 w-[min(82vw,280px)] bg-slate-100/80 dark:bg-slate-950 max-sm:dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 shrink-0 transition-transform sm:transition-all duration-300 flex flex-col ${
        mobileSidebarOpen ? "translate-x-0 shadow-xl max-sm:shadow-2xl max-sm:shadow-slate-950/40" : "-translate-x-full"
      } sm:relative sm:inset-auto sm:translate-x-0 sm:shadow-none ${
        sidebarOpen ? "sm:w-[292px]" : "sm:w-0 sm:overflow-hidden sm:border-r-0"
      }`}
    >
      <div className="p-3 border-b border-outline bg-surface/70 max-sm:dark:bg-slate-950 shrink-0 flex items-center gap-2">
        <button
          onClick={onCreateConversation}
          className="flex-1 h-9 px-3.5 bg-slate-950 hover:bg-slate-800 text-white text-[13px] font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shadow-xs dark:bg-indigo-600 dark:hover:bg-indigo-500"
          title={t("chatWorkspace.newChat")}
          disabled={!selectedId}
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>{t("chatWorkspace.newChat")}</span>
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
          className="p-2 text-content-muted hover:text-content-secondary rounded-lg hidden sm:block hover:bg-surface-muted"
          title={t("chatWorkspace.sidebarToggle")}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCloseMobileSidebar}
          className="p-2 text-content-muted hover:text-content-secondary rounded-lg sm:hidden hover:bg-surface-muted"
          title={t("chatWorkspace.sidebarToggle")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-1.5 [-webkit-overflow-scrolling:touch]" onScroll={onScroll}>
        {loadingConversations ? (
          <div className="space-y-2 p-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 bg-surface/70 rounded-lg animate-pulse border border-outline/70" />
            ))}
          </div>
        ) : !hasAnyConversation ? (
          <div className="text-center py-8 px-4 text-content-muted text-[13px]">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p>{t("chatWorkspace.emptyHistory")}</p>
            <p className="text-[11px] text-content-muted mt-1">{t("chatWorkspace.emptyHistoryDesc")}</p>
          </div>
        ) : (
          <>
            {pinnedConversations.length > 0 && (
              <>
                {renderSectionTitle(t("chatWorkspace.pinnedChats"), <Pin className="h-3 w-3" />)}
                <div className="space-y-1.5">{pinnedConversations.map(renderConversation)}</div>
              </>
            )}

            {projectGroups.length > 0 && (
              <>
                {renderSectionTitle(t("chatWorkspace.projects"), <Folder className="h-3 w-3" />)}
                <div className="space-y-2">
                  {projectGroups.map(({ project, items }, projectIndex) => (
                    <Fragment key={project.id}>
                      <div className="group/project flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] font-semibold text-content-muted hover:bg-surface/70">
                        <Folder className="h-3.5 w-3.5 text-slate-400" />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        <span className="rounded-full bg-outline/70 px-1.5 py-0.5 text-[10px] font-semibold text-content-muted">{items.length}</span>
                        <button
                          type="button"
                          onClick={(event) => onMoveProject(project.id, "up", event)}
                          disabled={projectIndex <= 0}
                          className="rounded p-1 text-slate-400 opacity-100 hover:bg-outline hover:text-content-secondary disabled:cursor-not-allowed disabled:opacity-25 sm:opacity-0 sm:group-hover/project:opacity-100"
                          title={t("chatWorkspace.moveProjectUp")}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => onMoveProject(project.id, "down", event)}
                          disabled={projectIndex >= projectGroups.length - 1}
                          className="rounded p-1 text-slate-400 opacity-100 hover:bg-outline hover:text-content-secondary disabled:cursor-not-allowed disabled:opacity-25 sm:opacity-0 sm:group-hover/project:opacity-100"
                          title={t("chatWorkspace.moveProjectDown")}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); openRenameProjectModal(project); }}
                          className="rounded p-1 text-slate-400 opacity-100 hover:bg-outline hover:text-content-secondary sm:opacity-0 sm:group-hover/project:opacity-100"
                          title={t("chatWorkspace.renameProject")}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onDeleteProject(project.id); }}
                          className="rounded p-1 text-slate-400 opacity-100 hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover/project:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          title={t("chatWorkspace.deleteProject")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-1.5 pl-2">{items.length > 0 ? items.map(renderConversation) : (
                        <div className="rounded-lg border border-dashed border-outline bg-surface/45 px-4 py-2 text-[11px] text-content-muted">{t("chatWorkspace.emptyProject")}</div>
                      )}</div>
                    </Fragment>
                  ))}
                </div>
              </>
            )}

            {recentConversations.length > 0 && (
              <>
                {renderSectionTitle(t("chatWorkspace.recentChats"))}
                <div className="space-y-1.5">{recentConversations.map(renderConversation)}</div>
              </>
            )}
          </>
        )}

        {loadingMoreConversations && (
          <div className="py-2 text-center text-[11px] text-content-muted animate-pulse">
            {t("chatWorkspace.loadingMore")}
          </div>
        )}
      </div>

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
