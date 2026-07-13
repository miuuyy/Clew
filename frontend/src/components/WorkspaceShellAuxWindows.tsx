import React from "react";
import { CaretDown, CaretRight, Check, DownloadSimple, FolderOpen, FolderSimple, PencilSimple } from "@phosphor-icons/react";

import type { GraphChatState } from "../lib/appContracts";
import type { AppCopy } from "../lib/appCopy";
import { computeRootTopicIds, formatTopicState, getTopicStateTone } from "../lib/graph";
import { AssistantComposer } from "./assistant/AssistantComposer";
import { AssistantSessionList } from "./assistant/AssistantSessionList";
import { AssistantThread } from "./assistant/AssistantThread";
import type { ChatSessionSummary, GraphEnvelope } from "../lib/types";
import type { TopicAnchorPoint } from "./GraphCanvas";

export function AssistantModelMenuTrigger({
  options,
  selectedModel,
  setSelectedModel,
  ariaLabel,
  stopPointerDown = false,
}: {
  options: string[];
  selectedModel: string | null;
  setSelectedModel: React.Dispatch<React.SetStateAction<string | null>>;
  ariaLabel: string;
  stopPointerDown?: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="assistantInlineModelTrigger"
      onPointerDown={stopPointerDown ? (event) => event.stopPropagation() : undefined}
    >
      <button
        className={`assistantModelMenuButton ${open ? "assistantModelMenuButtonOpen" : ""}`}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CaretDown className="assistantModelMenuCaret" size={12} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div className="assistantModelMenu" role="menu">
          {options.map((modelId) => {
            const active = modelId === (selectedModel ?? options[0]);
            return (
              <button
                key={modelId}
                className={`assistantModelMenuItem ${active ? "assistantModelMenuItemActive" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setSelectedModel(modelId);
                  setOpen(false);
                }}
              >
                <span className="assistantModelMenuItemLabel">{modelId}</span>
                {active ? <Check size={12} weight="bold" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function LightWorkspaceWindow({
  workspaceWindowRef,
  workspaceWindowPosition,
  beginFloatingDrag,
  copy,
  availableGraphs,
  setCreateGraphOpen,
  setCreateGraphError,
  closing,
  activeGraph,
  lightWorkspaceExpandedGraphId,
  setLightWorkspaceExpandedGraphId,
  setActiveGraphId,
  setSelectedTopicId,
  setSelectedTopicAnchor,
  renamingGraphId,
  renameGraphDraft,
  setRenameGraphDraft,
  renameGraph,
  setRenamingGraphId,
  setError,
  renameGraphSaving,
  openExportGraphModal,
  setDeleteConfirm,
  selectedTopicId,
  handleSelectTopic,
}: {
  workspaceWindowRef: React.RefObject<HTMLDivElement | null>;
  workspaceWindowPosition: { x: number; y: number };
  beginFloatingDrag: (target: "workspace", event: React.PointerEvent<HTMLElement>) => void;
  copy: AppCopy;
  availableGraphs: GraphEnvelope[];
  setCreateGraphOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateGraphError: React.Dispatch<React.SetStateAction<string | null>>;
  activeGraph: GraphEnvelope | null;
  lightWorkspaceExpandedGraphId: string | null;
  setLightWorkspaceExpandedGraphId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveGraphId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTopicId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedTopicAnchor: React.Dispatch<React.SetStateAction<TopicAnchorPoint | null>>;
  renamingGraphId: string | null;
  renameGraphDraft: string;
  setRenameGraphDraft: React.Dispatch<React.SetStateAction<string>>;
  renameGraph: (graphId: string) => Promise<void>;
  setRenamingGraphId: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  renameGraphSaving: boolean;
  openExportGraphModal: (graph: GraphEnvelope) => void;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<{ graphId: string; title: string } | null>>;
  selectedTopicId: string | null;
  handleSelectTopic: (topicId: string | null, anchor: TopicAnchorPoint | null) => void;
  closing?: boolean;
}): React.JSX.Element {
  return (
    <div
      ref={workspaceWindowRef}
      className={`lightFloatingWindow lightWorkspaceWindow ${closing ? "lightFloatingWindowExit" : "lightFloatingWindowEnter"}`}
      style={{ left: `${workspaceWindowPosition.x}px`, top: `${workspaceWindowPosition.y}px` }}
    >
      <div className="lightFloatingWindowHeader" onPointerDown={(event) => beginFloatingDrag("workspace", event)}>
        <div>
          <div className="lightFloatingWindowTitle">{copy.shell.workspace}</div>
          <div className="lightFloatingWindowSubtle">{copy.shell.workspaceCount(availableGraphs.length)}</div>
        </div>
        <div className="lightWorkspaceWindowHeaderActions">
          <button
            className="lightWindowActionButton lightWindowCreateWorkspaceButton"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              setCreateGraphOpen(true);
              setCreateGraphError(null);
            }}
            title={copy.emptyState.createGraph}
            type="button"
          >
            <span className="lightWindowCreateWorkspaceGlyph">+</span>
            <span>{copy.shell.newWorkspace}</span>
          </button>
        </div>
      </div>
      <div className="lightWorkspaceWindowBody lightWorkspaceExplorerBody">
        {availableGraphs.map((graph) => {
          const isActiveGraph = graph.graph_id === activeGraph?.graph_id;
          const isExpanded = lightWorkspaceExpandedGraphId === graph.graph_id;
          const completedTopics = graph.topics.filter((topic) => topic.state === "solid" || topic.state === "mastered").length;
          const rootTopicIds = computeRootTopicIds(graph);

          return (
            <section
              key={graph.graph_id}
              className={`lightWorkspaceFolder ${isActiveGraph ? "lightWorkspaceFolderActive" : ""} ${isExpanded ? "lightWorkspaceFolderOpen" : ""}`}
            >
              <div className="lightWorkspaceFolderRow">
                <button
                  className="lightWorkspaceFolderMain"
                  onClick={() => {
                    setLightWorkspaceExpandedGraphId((current) => current === graph.graph_id ? null : graph.graph_id);
                    setActiveGraphId(graph.graph_id);
                    setSelectedTopicId(null);
                    setSelectedTopicAnchor(null);
                  }}
                  type="button"
                >
                  <span className="lightWorkspaceFolderCaret">
                    {isExpanded ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
                  </span>
                  <span className="lightWorkspaceFolderIcon">
                    {isExpanded ? <FolderOpen size={18} weight="duotone" /> : <FolderSimple size={18} weight="duotone" />}
                  </span>
                  {renamingGraphId === graph.graph_id ? (
                    <input
                      className="lightWorkspaceFolderInput"
                      value={renameGraphDraft}
                      onChange={(event) => setRenameGraphDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void renameGraph(graph.graph_id);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingGraphId(null);
                          setRenameGraphDraft("");
                        }
                      }}
                      autoFocus
                      spellCheck={false}
                      aria-label={copy.sidebar.graphTitle}
                    />
                  ) : (
                    <span className="lightWorkspaceFolderMeta">
                      <span className="lightWorkspaceFolderTitleRow">
                        <span className="lightWorkspaceFolderTitle">{graph.title}</span>
                        <span className="lightWorkspaceFolderCount">{graph.topics.length}</span>
                      </span>
                      <span className="lightWorkspaceFolderSubtle">{graph.language.toUpperCase()} · {copy.shell.closedTopics(completedTopics)}</span>
                    </span>
                  )}
                </button>
                <div className="lightWorkspaceFolderActions">
                  <button
                    className="lightWorkspaceFolderAction"
                    onClick={() => openExportGraphModal(graph)}
                    title={copy.sidebar.exportGraph(graph.title)}
                    type="button"
                  >
                    <DownloadSimple size={14} weight="bold" />
                  </button>
                  <button
                    className={`lightWorkspaceFolderAction ${renamingGraphId === graph.graph_id ? "lightWorkspaceFolderActionActive" : ""}`}
                    onClick={() => {
                      if (renamingGraphId === graph.graph_id) {
                        void renameGraph(graph.graph_id);
                        return;
                      }
                      setError(null);
                      setRenamingGraphId(graph.graph_id);
                      setRenameGraphDraft(graph.title);
                    }}
                    title={renamingGraphId === graph.graph_id ? copy.sidebar.saveGraphTitle : copy.sidebar.renameGraph(graph.title)}
                    disabled={renameGraphSaving && renamingGraphId === graph.graph_id}
                    type="button"
                  >
                    {renamingGraphId === graph.graph_id ? copy.settingsPanel.save : <PencilSimple size={14} weight="bold" />}
                  </button>
                  <button
                    className="lightWorkspaceFolderAction lightWorkspaceFolderActionDanger"
                    onClick={() => setDeleteConfirm({ graphId: graph.graph_id, title: graph.title })}
                    title={copy.sidebar.deleteGraph(graph.title)}
                    type="button"
                  >
                    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M5 2V1h6v1h3v1H2V2h3zm1 3v7h1V5H6zm3 0v7h1V5H9zM3 4h10l-.8 10H3.8L3 4z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
              {isExpanded ? (
                <div className="lightWorkspaceTopicList">
                  {graph.topics.length > 0 ? (
                    graph.topics.map((topic) => {
                      const isSelectedTopic = isActiveGraph && selectedTopicId === topic.id;
                      const isRootTopic = rootTopicIds.has(topic.id);
                      const topicStateTone = getTopicStateTone(topic.state);
                      return (
                        <button
                          key={topic.id}
                          className={`lightWorkspaceTopicItem ${isSelectedTopic ? "lightWorkspaceTopicItemActive" : ""}`}
                          aria-label={`${topic.title} — ${formatTopicState(topic.state)}`}
                          onClick={() => {
                            setActiveGraphId(graph.graph_id);
                            handleSelectTopic(topic.id, null);
                          }}
                          type="button"
                        >
                          <span
                            className={`lightWorkspaceTopicBullet lightWorkspaceTopicBullet${topicStateTone === "good" ? "Good" : topicStateTone === "warn" ? "Warn" : "Neutral"} ${isRootTopic ? "lightWorkspaceTopicBulletRoot" : ""}`}
                          />
                          <span className="lightWorkspaceTopicLabel">{topic.title}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="lightWorkspaceTopicEmpty">{copy.shell.noTopicsYet}</div>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function TopicAssetModal({
  topicAssetDialog,
  themeMode,
  topicAssetModalRef,
  closeTopicAssetModal,
  copy,
  topicAssetPrimaryInputRef,
  topicResourceUrlDraft,
  setTopicResourceUrlDraft,
  topicArtifactTitleDraft,
  setTopicArtifactTitleDraft,
  topicArtifactBodyDraft,
  setTopicArtifactBodyDraft,
  topicAssetError,
  topicAssetSaving,
  submitTopicAssetDialog,
}: {
  topicAssetDialog: { kind: "resource" | "artifact"; topicId: string; topicTitle: string };
  themeMode: "light" | "dark";
  topicAssetModalRef: React.RefObject<HTMLDivElement | null>;
  closeTopicAssetModal: () => void;
  copy: AppCopy;
  topicAssetPrimaryInputRef: React.MutableRefObject<HTMLElement | null>;
  topicResourceUrlDraft: string;
  setTopicResourceUrlDraft: React.Dispatch<React.SetStateAction<string>>;
  topicArtifactTitleDraft: string;
  setTopicArtifactTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  topicArtifactBodyDraft: string;
  setTopicArtifactBodyDraft: React.Dispatch<React.SetStateAction<string>>;
  topicAssetError: string | null;
  topicAssetSaving: boolean;
  submitTopicAssetDialog: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div className={`quizOverlay topicAssetOverlay ${themeMode === "light" ? "topicAssetOverlayLight" : "topicAssetOverlayDark"}`}>
      <div
        ref={topicAssetModalRef}
        className="quizModal topicAssetModal"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="topic-asset-dialog-title"
        aria-describedby="topic-asset-dialog-description"
        tabIndex={-1}
      >
        <div className="quizModalHeader">
          <div className="topicAssetHeaderCopy">
            <div id="topic-asset-dialog-title" className="cardTitle">
              {topicAssetDialog.kind === "resource" ? copy.dialogs.addResourceTitle : copy.dialogs.addArtifactTitle}
            </div>
            <div id="topic-asset-dialog-description" className="mutedSmall">
              {topicAssetDialog.kind === "resource" ? copy.dialogs.addResourceBody : copy.dialogs.addArtifactBody}
            </div>
            <div className="mutedSmall topicAssetTopicTitle">{topicAssetDialog.topicTitle}</div>
          </div>
          <button className="modalCloseButton" onClick={closeTopicAssetModal} type="button">
            ×
          </button>
        </div>
        <div className="quizModalBody stack topicAssetModalBody">
          {topicAssetDialog.kind === "resource" ? (
            <label className="field topicAssetField">
              <span className="fieldLabel topicAssetFieldLabel">{copy.dialogs.resourceUrl}</span>
              <textarea
                ref={(node) => {
                  topicAssetPrimaryInputRef.current = node;
                }}
                className="textarea textareaCompact textareaPersona topicAssetResourceInput"
                value={topicResourceUrlDraft}
                onChange={(event) => setTopicResourceUrlDraft(event.target.value)}
                placeholder={copy.dialogs.resourceUrlPlaceholder}
              />
            </label>
          ) : (
            <>
              <label className="field topicAssetField">
                <span className="fieldLabel topicAssetFieldLabel">{copy.dialogs.artifactTitle}</span>
                <input
                  ref={(node) => {
                    topicAssetPrimaryInputRef.current = node;
                  }}
                  className="input topicAssetTextInput"
                  value={topicArtifactTitleDraft}
                  onChange={(event) => setTopicArtifactTitleDraft(event.target.value)}
                  placeholder={copy.dialogs.artifactTitlePlaceholder}
                />
              </label>
              <label className="field topicAssetField">
                <span className="fieldLabel topicAssetFieldLabel">{copy.dialogs.artifactBodyLabel}</span>
                <textarea
                  className="textarea textareaCompact textareaPersona topicAssetTextInput"
                  value={topicArtifactBodyDraft}
                  onChange={(event) => setTopicArtifactBodyDraft(event.target.value)}
                  placeholder={copy.dialogs.artifactBodyPlaceholder}
                />
              </label>
            </>
          )}
          {topicAssetError ? <div className="inlineNotice inlineNoticeError">{topicAssetError}</div> : null}
          <div className="quizActions quizActionsRight">
            <button
              className="assistantSendButton quizSubmitButton topicAssetSaveButton"
              disabled={
                topicAssetSaving ||
                (topicAssetDialog.kind === "resource"
                  ? !topicResourceUrlDraft.trim()
                  : !topicArtifactTitleDraft.trim() || !topicArtifactBodyDraft.trim())
              }
              onClick={() => void submitTopicAssetDialog()}
              type="button"
            >
              {topicAssetSaving
                ? copy.dialogs.creating
                : topicAssetDialog.kind === "resource"
                  ? copy.dialogs.saveResource
                  : copy.dialogs.saveArtifact}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LightChatWindow({
  chatWindowRef,
  chatWindowPosition,
  assistantWidth,
  beginFloatingDrag,
  assistantDisplayName,
  activeSession,
  selectedTopic,
  activeGraph,
  copy,
  sessionListWrapRef,
  sessionListRef,
  sessionDragRef,
  activeSessionId,
  setActiveSessionId,
  generalSession,
  topicSessions,
  setSessionDeleteConfirm,
  chatSessions,
  selectedTopicId,
  createTopicSession,
  chatViewportRef,
  currentChatState,
  chatThreadLoading,
  visibleMessages,
  chatLoading,
  hasInlinePlanningWidget,
  applyLoadingMessageId,
  applyProposalFromMessage,
  updateCurrentChatState,
  chatComposerRef,
  chatError,
  chatSessionsError,
  applyError,
  composerUseGrounding,
  setComposerUseGrounding,
  assistantTemplates,
  chatModelOptions,
  selectedChatModel,
  setSelectedChatModel,
  sendChat,
  closing,
}: {
  chatWindowRef: React.RefObject<HTMLDivElement | null>;
  chatWindowPosition: { x: number; y: number };
  assistantWidth: number;
  closing?: boolean;
  beginFloatingDrag: (target: "chat", event: React.PointerEvent<HTMLElement>) => void;
  assistantDisplayName: string;
  activeSession: ChatSessionSummary | null;
  selectedTopic: { id: string; title: string } | null;
  activeGraph: GraphEnvelope | null;
  copy: AppCopy;
  sessionListWrapRef: React.RefObject<HTMLDivElement | null>;
  sessionListRef: React.RefObject<HTMLDivElement | null>;
  sessionDragRef: React.MutableRefObject<{ startX: number; scrollLeft: number } | null>;
  activeSessionId: string | null;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  generalSession: ChatSessionSummary | null;
  topicSessions: ChatSessionSummary[];
  setSessionDeleteConfirm: React.Dispatch<React.SetStateAction<{ sessionId: string; title: string } | null>>;
  chatSessions: ChatSessionSummary[];
  selectedTopicId: string | null;
  createTopicSession: () => Promise<void>;
  chatViewportRef: React.RefObject<HTMLDivElement | null>;
  currentChatState: GraphChatState;
  chatThreadLoading: boolean;
  visibleMessages: GraphChatState["messages"];
  chatLoading: boolean;
  hasInlinePlanningWidget: boolean;
  applyLoadingMessageId: string | null;
  applyProposalFromMessage: (messageId: string, proposal: NonNullable<GraphChatState["messages"][number]["proposal"]>) => Promise<void>;
  updateCurrentChatState: (updater: (current: GraphChatState) => GraphChatState) => void;
  chatComposerRef: React.RefObject<HTMLTextAreaElement | null>;
  chatError: string | null;
  chatSessionsError: string | null;
  applyError: string | null;
  composerUseGrounding: boolean;
  setComposerUseGrounding: React.Dispatch<React.SetStateAction<boolean>>;
  assistantTemplates: Array<{ id: string; label: string; value: string }>;
  chatModelOptions: string[];
  selectedChatModel: string | null;
  setSelectedChatModel: React.Dispatch<React.SetStateAction<string | null>>;
  sendChat: () => Promise<void>;
}): React.JSX.Element {
  return (
    <div
      ref={chatWindowRef}
      className={`lightFloatingWindow lightChatWindow ${closing ? "lightFloatingWindowExit" : "lightFloatingWindowEnter"}`}
      style={{
        left: `${chatWindowPosition.x}px`,
        top: `${chatWindowPosition.y}px`,
        width: `${Math.min(Math.max(assistantWidth, 390), 460)}px`,
      }}
    >
      <div className="lightFloatingWindowHeader" onPointerDown={(event) => beginFloatingDrag("chat", event)}>
        <div>
          <div className="assistantDockTitleRow">
            <div className="lightFloatingWindowTitle">{assistantDisplayName}</div>
            <AssistantModelMenuTrigger
              options={chatModelOptions}
              selectedModel={selectedChatModel}
              setSelectedModel={setSelectedChatModel}
              ariaLabel={copy.sessions.modelPicker}
              stopPointerDown
            />
          </div>
          <div className="lightFloatingWindowSubtle">
            {activeSession?.topic_id
              ? copy.sessions.learningSession
              : selectedTopic
                ? copy.sessions.focusedOn(selectedTopic.title)
                : activeGraph?.title ?? copy.sessions.noGraphSelected}
          </div>
        </div>
      </div>
      <AssistantSessionList
        copy={copy}
        sessionListWrapRef={sessionListWrapRef}
        sessionListRef={sessionListRef}
        sessionDragRef={sessionDragRef}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        generalSession={generalSession}
        topicSessions={topicSessions}
        setSessionDeleteConfirm={setSessionDeleteConfirm}
        chatSessions={chatSessions}
        selectedTopic={selectedTopic}
        selectedTopicId={selectedTopicId}
        createTopicSession={createTopicSession}
        chipClassName="lightChatSessionChip"
        chipActiveClassName="lightChatSessionChipActive"
      />
      <div className="sessionShadow" />
      <AssistantThread
        copy={copy}
        chatViewportRef={chatViewportRef}
        chatThreadLoading={chatThreadLoading}
        currentChatState={currentChatState}
        visibleMessages={visibleMessages}
        chatLoading={chatLoading}
        hasInlinePlanningWidget={hasInlinePlanningWidget}
        applyLoadingMessageId={applyLoadingMessageId}
        applyProposalFromMessage={applyProposalFromMessage}
        updateCurrentChatState={updateCurrentChatState}
        chatComposerRef={chatComposerRef}
      />
      <AssistantComposer
        copy={copy}
        chatError={chatError}
        chatSessionsError={chatSessionsError}
        applyError={applyError}
        composerUseGrounding={composerUseGrounding}
        setComposerUseGrounding={setComposerUseGrounding}
        assistantTemplates={assistantTemplates}
        updateCurrentChatState={updateCurrentChatState}
        chatComposerRef={chatComposerRef}
        currentChatState={currentChatState}
        chatLoading={chatLoading}
        chatThreadLoading={chatThreadLoading}
        sendChat={() => void sendChat()}
      />
    </div>
  );
}
