import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AppDialogs } from "./components/AppDialogs";
import { DebugLogsModal } from "./components/DebugLogsModal";
import { SettingsModal } from "./components/SettingsModal";
import { WorkspaceShell } from "./components/WorkspaceShell";
import { ClewLoader } from "./components/ClewLoader";
import type { TopicAnchorPoint } from "./components/GraphCanvas";
import { API_BASE } from "./lib/api";
import { APP_COPY } from "./lib/appCopy";
import { setDebugModeEnabled } from "./lib/debugLogs";
import {
  ASSISTANT_COLLAPSE_THRESHOLD,
  ASSISTANT_MAX_WIDTH,
  ASSISTANT_MIN_WIDTH,
  type AuthSessionPayload,
  type WorkspaceSurfacePayload,
} from "./lib/appContracts";
import { COMPACT_TOP_OVERLAY_THRESHOLD } from "./lib/appStatePersistence";
import {
  apiFetch,
  computePopoverPosition,
  type ManualLayoutPositions,
  readErrorMessage,
  readManualLayoutPositions,
  requiredCorrectAnswers,
  samePopoverPosition,
  shouldCommitAnchorUpdate,
  shouldKeepCurrentAnchor,
  type PopoverPosition,
} from "./lib/appUiHelpers";
import { canPlaceFloatingRect, toFloatingRect, type FloatingRect } from "./lib/floatingDesktopLayout";
import { markChatProposalApplied } from "./lib/chatRequests";
import {
  buildFallbackAssessment,
  computeClosureStatus,
  computeFocusData,
  computeGraphSummary,
  firstProposedTopicId,
  templatePrompt,
} from "./lib/graph";
import { supportsObsidianDirectoryExport, writeObsidianExportPackageToDirectory } from "./lib/obsidianExport";
import {
  buildObsidianImportPreview,
  type ObsidianImportOptions,
  type ObsidianVaultEntry,
} from "./lib/obsidianImport";
import { useChatModelSelection } from "./hooks/useChatModelSelection";
import { useGraphChatController } from "./hooks/useGraphChatController";
import { useWorkspaceSettings } from "./hooks/useWorkspaceSettings";
import { useWorkspaceChromeState } from "./hooks/useWorkspaceChromeState";
import { useTopicPopover } from "./hooks/useTopicPopover";
import { useModalAccessibility } from "./lib/useModalAccessibility";
import type {
  CreateGraphRequest,
  GraphEnvelope,
  GraphAssessment,
  GraphExportFormat,
  GraphExportPackagePayload,
  ObsidianExportOptions,
  ObsidianGraphExportPackagePayload,
  ProposalGenerateResponse,
  QuizQuestionReview,
  QuizStartResponse,
  QuizSubmitResponse,
  DebugLogSnapshot,
  SnapshotRecord,
  Topic,
  TopicQuizSession,
  WorkspaceEnvelope,
} from "./lib/types";

const ACTIVE_GRAPH_STORAGE_KEY = "knowledge_graph_active_graph_v1";

function defaultObsidianExportOptions(): ObsidianExportOptions {
  return {
    use_folders_as_zones: true,
    include_descriptions: true,
    include_resources: true,
    include_artifacts: true,
  };
}

export default function App(): React.JSX.Element {
  const copy = APP_COPY;
  const [data, setData] = useState<WorkspaceEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<GraphAssessment | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [createGraphDraft, setCreateGraphDraft] = useState<CreateGraphRequest>({
    title: "",
    subject: "",
    language: "en",
    description: "",
  });
  const [createGraphOpen, setCreateGraphOpen] = useState(false);
  const [createGraphLoading, setCreateGraphLoading] = useState(false);
  const [createGraphError, setCreateGraphError] = useState<string | null>(null);
  const [importGraphOpen, setImportGraphOpen] = useState(false);
  const [importGraphLoading, setImportGraphLoading] = useState(false);
  const [importGraphError, setImportGraphError] = useState<string | null>(null);
  const [importGraphFileName, setImportGraphFileName] = useState<string | null>(null);
  const [importGraphPayload, setImportGraphPayload] = useState<GraphExportPackagePayload | null>(null);
  const [importGraphTitleDraft, setImportGraphTitleDraft] = useState("");
  const [importGraphIncludeProgressDraft, setImportGraphIncludeProgressDraft] = useState(true);
  const [importObsidianOpen, setImportObsidianOpen] = useState(false);
  const [importObsidianLoading, setImportObsidianLoading] = useState(false);
  const [importObsidianError, setImportObsidianError] = useState<string | null>(null);
  const [obsidianVaultName, setObsidianVaultName] = useState<string | null>(null);
  const [obsidianVaultEntries, setObsidianVaultEntries] = useState<ObsidianVaultEntry[] | null>(null);
  const [obsidianImportDraft, setObsidianImportDraft] = useState<Omit<ObsidianImportOptions, "vaultName">>({
    graphTitle: "",
    subject: "",
    language: "en",
    relation: "bridges",
    useFoldersAsZones: true,
    autofillDescriptions: true,
    createArtifactsFromNotes: false,
    createPlaceholderTopics: false,
  });
  const [exportGraphTarget, setExportGraphTarget] = useState<GraphEnvelope | null>(null);
  const [exportGraphLoading, setExportGraphLoading] = useState(false);
  const [exportGraphError, setExportGraphError] = useState<string | null>(null);
  const [exportGraphTitleDraft, setExportGraphTitleDraft] = useState("");
  const [exportGraphIncludeProgressDraft, setExportGraphIncludeProgressDraft] = useState(true);
  const [exportGraphFormatDraft, setExportGraphFormatDraft] = useState<GraphExportFormat>("mapmind_graph_export");
  const [exportGraphObsidianOptionsDraft, setExportGraphObsidianOptionsDraft] = useState<ObsidianExportOptions>(defaultObsidianExportOptions);
  const [deleteConfirm, setDeleteConfirm] = useState<{ graphId: string; title: string } | null>(null);
  const [sessionDeleteConfirm, setSessionDeleteConfirm] = useState<{ sessionId: string; title: string } | null>(null);
  const [graphLayoutEditing, setGraphLayoutEditing] = useState(false);
  const [graphLayoutDraft, setGraphLayoutDraft] = useState<ManualLayoutPositions | null>(null);
  const [graphLayoutSaving, setGraphLayoutSaving] = useState(false);
  const [renamingGraphId, setRenamingGraphId] = useState<string | null>(null);
  const [renameGraphDraft, setRenameGraphDraft] = useState("");
  const [renameGraphSaving, setRenameGraphSaving] = useState(false);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(() => {
    try {
      const raw = localStorage.getItem(ACTIVE_GRAPH_STORAGE_KEY);
      return raw && raw.trim() ? raw : null;
    } catch {
      return null;
    }
  });
  const [applyLoadingMessageId, setApplyLoadingMessageId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [assistantResizing, setAssistantResizing] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [quizSession, setQuizSession] = useState<TopicQuizSession | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizSuccess, setQuizSuccess] = useState<string | null>(null);
  const [quizReviews, setQuizReviews] = useState<QuizQuestionReview[] | null>(null);
  const [sessionInfo, setSessionInfo] = useState<AuthSessionPayload | null>(null);
  const [workspaceSurface, setWorkspaceSurface] = useState<WorkspaceSurfacePayload | null>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLogSnapshot | null>(null);
  const [debugLogsLoading, setDebugLogsLoading] = useState(false);
  const [debugLogsError, setDebugLogsError] = useState<string | null>(null);
  const [composerUseGrounding, setComposerUseGrounding] = useState(true);
  const {
    assistantWidth,
    setAssistantWidth,
    isMobileViewport,
    viewportWidth,
    leftSidebarOpen,
    setLeftSidebarOpen,
    leftSidebarClosing,
    setLeftSidebarClosing,
    mobileMenuOpen,
    setMobileMenuOpen,
    isSettingsOpen,
    setSettingsOpen,
    isLogsOpen,
    setLogsOpen,
    viewportCenteredZoom,
    setViewportCenteredZoom,
    straightEdgeLinesEnabled,
    setStraightEdgeLinesEnabled,
    initialThemeMode,
    themeModeDraft,
    setThemeModeDraft,
  } = useWorkspaceChromeState();
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const deleteGraphModalRef = useRef<HTMLDivElement | null>(null);
  const deleteGraphCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionDeleteModalRef = useRef<HTMLDivElement | null>(null);
  const sessionDeleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const createGraphModalRef = useRef<HTMLDivElement | null>(null);
  const createGraphTitleInputRef = useRef<HTMLInputElement | null>(null);
  const importGraphModalRef = useRef<HTMLDivElement | null>(null);
  const importGraphFileButtonRef = useRef<HTMLButtonElement | null>(null);
  const importObsidianModalRef = useRef<HTMLDivElement | null>(null);
  const importObsidianFolderButtonRef = useRef<HTMLButtonElement | null>(null);
  const exportGraphModalRef = useRef<HTMLDivElement | null>(null);
  const exportGraphTitleInputRef = useRef<HTMLInputElement | null>(null);
  const importGraphFileInputRef = useRef<HTMLInputElement | null>(null);
  const importObsidianFolderInputRef = useRef<HTMLInputElement | null>(null);
  const quizModalRef = useRef<HTMLDivElement | null>(null);
  const quizCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const chatComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const sessionListWrapRef = useRef<HTMLDivElement | null>(null);
  const floatingStatsRef = useRef<HTMLDivElement | null>(null);
  const sessionDragRef = useRef<{ startX: number; scrollLeft: number } | null>(null);
  const bootstrapStartedRef = useRef(false);
  const composerGroundingSeededRef = useRef(false);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const closeDeleteGraphModal = useCallback(() => setDeleteConfirm(null), []);
  const closeSessionDeleteModal = useCallback(() => setSessionDeleteConfirm(null), []);
  const closeCreateGraphModal = useCallback(() => {
    setCreateGraphOpen(false);
    setCreateGraphError(null);
  }, []);
  const closeImportGraphModal = useCallback(() => {
    setImportGraphOpen(false);
    setImportGraphError(null);
    setImportGraphPayload(null);
    setImportGraphFileName(null);
    setImportGraphTitleDraft("");
    setImportGraphIncludeProgressDraft(true);
  }, []);
  const closeImportObsidianModal = useCallback(() => {
    setImportObsidianOpen(false);
    setImportObsidianError(null);
    setImportObsidianLoading(false);
    setObsidianVaultName(null);
    setObsidianVaultEntries(null);
    setObsidianImportDraft({
      graphTitle: "",
      subject: "",
      language: "en",
      relation: "bridges",
      useFoldersAsZones: true,
      autofillDescriptions: true,
      createArtifactsFromNotes: false,
      createPlaceholderTopics: false,
    });
  }, []);
  const closeExportGraphModal = useCallback(() => {
    setExportGraphTarget(null);
    setExportGraphError(null);
    setExportGraphLoading(false);
    setExportGraphTitleDraft("");
    setExportGraphIncludeProgressDraft(true);
    setExportGraphFormatDraft("mapmind_graph_export");
    setExportGraphObsidianOptionsDraft(defaultObsidianExportOptions());
  }, []);
  const openImportGraphModal = useCallback(() => {
    setCreateGraphOpen(false);
    setImportGraphOpen(true);
    setImportGraphError(null);
  }, []);
  const openImportObsidianModal = useCallback(() => {
    setCreateGraphOpen(false);
    setImportObsidianOpen(true);
    setImportObsidianError(null);
  }, []);
  const openExportGraphModal = useCallback((graph: GraphEnvelope) => {
    setExportGraphTarget(graph);
    setExportGraphTitleDraft(graph.title);
    setExportGraphIncludeProgressDraft(true);
    setExportGraphFormatDraft("mapmind_graph_export");
    setExportGraphObsidianOptionsDraft(defaultObsidianExportOptions());
    setExportGraphError(null);
  }, []);
  const closeQuizModal = useCallback(() => {
    setQuizSession(null);
    setQuizError(null);
  }, []);

  useModalAccessibility({
    isOpen: Boolean(deleteConfirm),
    modalRef: deleteGraphModalRef,
    onClose: closeDeleteGraphModal,
    initialFocusRef: deleteGraphCancelButtonRef,
  });
  useModalAccessibility({
    isOpen: Boolean(sessionDeleteConfirm),
    modalRef: sessionDeleteModalRef,
    onClose: closeSessionDeleteModal,
    initialFocusRef: sessionDeleteCancelButtonRef,
  });
  useModalAccessibility({
    isOpen: createGraphOpen,
    modalRef: createGraphModalRef,
    onClose: closeCreateGraphModal,
    initialFocusRef: createGraphTitleInputRef,
  });
  useModalAccessibility({
    isOpen: importGraphOpen,
    modalRef: importGraphModalRef,
    onClose: closeImportGraphModal,
    initialFocusRef: importGraphFileButtonRef,
  });
  useModalAccessibility({
    isOpen: importObsidianOpen,
    modalRef: importObsidianModalRef,
    onClose: closeImportObsidianModal,
    initialFocusRef: importObsidianFolderButtonRef,
  });
  useModalAccessibility({
    isOpen: Boolean(exportGraphTarget),
    modalRef: exportGraphModalRef,
    onClose: closeExportGraphModal,
    initialFocusRef: exportGraphTitleInputRef,
  });
  useModalAccessibility({
    isOpen: Boolean(quizSession),
    modalRef: quizModalRef,
    onClose: closeQuizModal,
    initialFocusRef: quizCloseButtonRef,
  });

  useEffect(() => {
    try {
      if (activeGraphId) {
        localStorage.setItem(ACTIVE_GRAPH_STORAGE_KEY, activeGraphId);
      } else {
        localStorage.removeItem(ACTIVE_GRAPH_STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage write failures.
    }
  }, [activeGraphId]);

  useEffect(() => {
    const input = importObsidianFolderInputRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.multiple = true;
  }, [importObsidianOpen]);

  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchWorkspace();
        setData(payload);
        const fallbackGraphId = payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null;
        setActiveGraphId((previous) => previous ?? fallbackGraphId);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : copy.errors.loadWorkspace);
      } finally {
        setLoading(false);
      }
    }
    void load();
    void loadSnapshots();
  }, []);

  const obsidianImportPreview = useMemo(() => {
    if (!obsidianVaultEntries || !obsidianVaultName) return null;
    return buildObsidianImportPreview(obsidianVaultEntries, {
      vaultName: obsidianVaultName,
      ...obsidianImportDraft,
    });
  }, [obsidianImportDraft, obsidianVaultEntries, obsidianVaultName]);

  useEffect(() => {
    return () => {
      if (sidebarCloseTimerRef.current) {
        window.clearTimeout(sidebarCloseTimerRef.current);
      }
    };
  }, []);

  const availableGraphs = useMemo(() => data?.workspace.graphs ?? [], [data]);
  const activeGraph = useMemo(
    () => availableGraphs.find((graph) => graph.graph_id === activeGraphId) ?? availableGraphs[0] ?? null,
    [activeGraphId, availableGraphs],
  );
  const activeGraphManualLayout = useMemo(() => readManualLayoutPositions(activeGraph), [activeGraph]);
  const {
    selectedTopicId,
    setSelectedTopicId,
    selectedTopicAnchor,
    setSelectedTopicAnchor,
    selectedTopic,
    popoverPosition,
    topicPopoverRef,
    popoverDragRef,
    handleSelectedTopicAnchorChange,
    handleSelectTopic,
  } = useTopicPopover({ activeGraph, isMobileViewport, graphShellRef });
  useEffect(() => {
    setQuizSuccess(null);
  }, [selectedTopicId]);

  useEffect(() => {
    setApplyError(null);
    setQuizSession(null);
    setQuizAnswers({});
    setQuizError(null);
    setQuizSuccess(null);
    setQuizReviews(null);
    setGraphLayoutEditing(false);
    setGraphLayoutDraft(null);
  }, [activeGraph?.graph_id]);

  const currentConfig = data?.workspace.config ?? null;
  const settingsState = useWorkspaceSettings({
    config: currentConfig,
    updateWorkspaceConfig: async (patch) => {
      setConfigSaving(true);
      setError(null);
      try {
        const response = await apiFetch(`${API_BASE}/api/v1/workspace/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(payload?.detail ?? `config update failed with ${response.status}`);
        }
        const payload = (await response.json()) as WorkspaceEnvelope;
        setData(payload);
        void loadSnapshots();
        void loadWorkspaceSurface();
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : copy.errors.updateConfig);
      } finally {
        setConfigSaving(false);
      }
    },
    straightEdgeLinesEnabled,
    setStraightEdgeLinesEnabled,
    initialThemeMode,
  });
  const {
    provider: providerDraft,
    model: modelDraft,
    modelPreset: modelPresetDraft,
    geminiApiKey: geminiApiKeyDraft,
    openaiApiKey: openaiApiKeyDraft,
    openaiBaseUrl: openaiBaseUrlDraft,
    showOpenAIEndpoint: showOpenAIEndpointDraft,
    thinkingMode: thinkingModeDraft,
    plannerMaxTokens: plannerMaxTokensDraft,
    plannerThinkingBudget: plannerThinkingBudgetDraft,
    orchestratorMaxTokens: orchestratorMaxTokensDraft,
    quizMaxTokens: quizMaxTokensDraft,
    assistantMaxTokens: assistantMaxTokensDraft,
    assistantNickname: assistantNicknameDraft,
    persona: personaDraft,
    disableIdleAnimations: disableIdleAnimationsDraft,
    memoryMode: memoryModeDraft,
    memoryHistoryLimit: memoryHistoryLimitDraft,
    memoryIncludeGraphContext: memoryIncludeGraphContextDraft,
    memoryIncludeProgressContext: memoryIncludeProgressContextDraft,
    memoryIncludeQuizContext: memoryIncludeQuizContextDraft,
    memoryIncludeFrontierContext: memoryIncludeFrontierContextDraft,
    memoryIncludeSelectedTopicContext: memoryIncludeSelectedTopicContextDraft,
    enableClosureTests: enableClosureTestsDraft,
    debugModeEnabled: debugModeEnabledDraft,
    straightEdgeLines: straightEdgeLinesDraft,
    quizQuestionCount: quizQuestionCountDraft,
    quizPassCount: quizPassCountDraft,
  } = settingsState.drafts;
  const {
    provider: setProviderDraft,
    model: setModelDraft,
    modelPreset: setModelPresetDraft,
    geminiApiKey: setGeminiApiKeyDraft,
    openaiApiKey: setOpenaiApiKeyDraft,
    openaiBaseUrl: setOpenaiBaseUrlDraft,
    showOpenAIEndpoint: setShowOpenAIEndpointDraft,
    thinkingMode: setThinkingModeDraft,
    plannerMaxTokens: setPlannerMaxTokensDraft,
    plannerThinkingBudget: setPlannerThinkingBudgetDraft,
    orchestratorMaxTokens: setOrchestratorMaxTokensDraft,
    quizMaxTokens: setQuizMaxTokensDraft,
    assistantMaxTokens: setAssistantMaxTokensDraft,
    assistantNickname: setAssistantNicknameDraft,
    persona: setPersonaDraft,
    disableIdleAnimations: setDisableIdleAnimationsDraft,
    memoryMode: setMemoryModeDraft,
    memoryHistoryLimit: setMemoryHistoryLimitDraft,
    memoryIncludeGraphContext: setMemoryIncludeGraphContextDraft,
    memoryIncludeProgressContext: setMemoryIncludeProgressContextDraft,
    memoryIncludeQuizContext: setMemoryIncludeQuizContextDraft,
    memoryIncludeFrontierContext: setMemoryIncludeFrontierContextDraft,
    memoryIncludeSelectedTopicContext: setMemoryIncludeSelectedTopicContextDraft,
    enableClosureTests: setEnableClosureTestsDraft,
    debugModeEnabled: setDebugModeEnabledDraft,
    straightEdgeLines: setStraightEdgeLinesDraft,
    quizQuestionCount: setQuizQuestionCountDraft,
    quizPassCount: setQuizPassCountDraft,
  } = settingsState.setDrafts;

  const { chatModelOptions, selectedChatModel, setSelectedChatModel } = useChatModelSelection(
    currentConfig,
    activeGraph?.graph_id ?? null,
  );
  const {
    activeSessionId,
    setActiveSessionId,
    chatSessions,
    currentChatState,
    chatLoading,
    chatThreadLoading,
    chatError,
    chatSessionsError,
    updateCurrentChatState,
    clearChatStateForGraph,
    loadSessions,
    sendChat,
  } = useGraphChatController({
    activeGraph,
    selectedTopicId,
    selectedChatModel,
    defaultModel: currentConfig?.default_model ?? null,
    memoryHistoryMessageLimit: currentConfig?.memory_history_message_limit ?? 50,
    composerUseGrounding,
    largeGraphModelHint: copy.sessions.largeGraphModelHint,
    loadChatError: copy.errors.loadChat,
    loadChatSessionsError: copy.errors.loadChatSessions,
  });

  useEffect(() => {
    if (!isSettingsOpen) return;
    setStraightEdgeLinesDraft(straightEdgeLinesEnabled);
  }, [isSettingsOpen, straightEdgeLinesEnabled]);

  useEffect(() => {
    if (!isMobileViewport) return;
    setLeftSidebarOpen(false);
    setLeftSidebarClosing(false);
    setAssistantWidth(0);
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport || activeGraph) return;
    setAssistantWidth(0);
  }, [activeGraph, isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileMenuOpen(false);
      return;
    }
    if (isSettingsOpen) {
      setMobileMenuOpen(false);
    }
  }, [isMobileViewport, isSettingsOpen]);

  useEffect(() => {
    setQuizPassCountDraft((current) => Math.min(current, quizQuestionCountDraft));
  }, [quizQuestionCountDraft]);

  const focusData = useMemo(() => computeFocusData(activeGraph, selectedTopicId), [activeGraph, selectedTopicId]);
  const graphSummary = useMemo(() => computeGraphSummary(activeGraph), [activeGraph]);
  const fallbackAssessment = useMemo(() => buildFallbackAssessment(activeGraph, copy), [activeGraph, copy]);
  const zoneTitlesById = useMemo(() => new Map((activeGraph?.zones ?? []).map((zone) => [zone.id, zone.title])), [activeGraph]);
  const topicTitlesById = useMemo(() => new Map((activeGraph?.topics ?? []).map((topic) => [topic.id, topic.title])), [activeGraph]);
  const selectedZoneTitles = useMemo(
    () => (selectedTopic?.zones ?? []).map((zoneId) => zoneTitlesById.get(zoneId) ?? zoneId),
    [selectedTopic, zoneTitlesById],
  );
  const selectedZoneLabel = selectedZoneTitles.join(" · ");
  const selectedResourceLinks = useMemo(() => selectedTopic?.resources ?? [], [selectedTopic]);
  const selectedArtifacts = useMemo(() => selectedTopic?.artifacts ?? [], [selectedTopic]);
  const selectedClosureStatus = useMemo(() => computeClosureStatus(activeGraph, selectedTopicId), [activeGraph, selectedTopicId]);
  const activeAssessmentCards = useMemo(
    () => (assessment?.cards.length ? assessment.cards : fallbackAssessment.cards).filter((card) => !["Roadmap", "Closure"].includes(card.label)),
    [assessment?.cards, fallbackAssessment.cards],
  );
  const sessionUser = sessionInfo?.user ?? null;
  const onboardingNeedsFirstGraph = !activeGraph && workspaceSurface?.onboarding_state === "needs_first_graph";
  const { geminiKeyLockedByEnv, openaiKeyLockedByEnv, openaiBaseUrlLockedByEnv } = settingsState.locks;
  const liveDisableIdleAnimations =
    isSettingsOpen
      ? disableIdleAnimationsDraft
      : Boolean(currentConfig?.disable_idle_animations);
  const closureTestsEnabled = currentConfig?.enable_closure_tests ?? true;
  const debugModeEnabled = currentConfig?.debug_mode_enabled ?? false;
  useEffect(() => {
    setDebugModeEnabled(debugModeEnabled);
    if (!debugModeEnabled) {
      setLogsOpen(false);
    }
  }, [debugModeEnabled]);
  const activeThinkingOption = settingsState.activeThinkingOption;
  const activeMemoryOption = settingsState.activeMemoryOption;
  const activeThinkingValues = settingsState.activeThinkingValues;
  const activeMemoryValues = settingsState.activeMemoryValues;
  const settingsDirty = settingsState.settingsDirty;
  const showGraphLoadingState = loading && !activeGraph;
  const showGraphEmptyState = !loading && !activeGraph;

  useEffect(() => {
    let cancelled = false;
    async function loadAssessment(): Promise<void> {
      if (!activeGraph) {
        setAssessment(null);
        setAssessmentError(null);
        return;
      }
      try {
        const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/assessment`);
        if (!response.ok) throw new Error(`assessment failed with ${response.status}`);
        const payload = (await response.json()) as GraphAssessment;
        if (cancelled) return;
        setAssessment(payload);
        setAssessmentError(null);
      } catch (loadError) {
        if (cancelled) return;
        setAssessment(null);
        setAssessmentError(loadError instanceof Error ? loadError.message : copy.errors.loadAssessment);
      }
    }
    void loadAssessment();
    return () => {
      cancelled = true;
    };
  }, [activeGraph?.graph_id, data?.snapshot.id]);

  // Auto-scroll only for new messages or active assistant loading.
  const lastMessagesLengthRef = useRef(0);
  useEffect(() => {
    const viewport = chatViewportRef.current;
    if (!viewport) return;
    const nextLength = currentChatState.messages.length;
    const grew = nextLength > lastMessagesLengthRef.current;
    lastMessagesLengthRef.current = nextLength;
    if (grew || chatLoading) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [currentChatState.messages, chatLoading]);

  function handleAssistantResize(startX: number): void {
    setAssistantResizing(true);
    const startWidth = assistantWidth;
    let latestWidth = assistantWidth;

    function onMouseMove(event: MouseEvent): void {
      const delta = startX - event.clientX;
      const nextWidth = Math.min(Math.max(0, startWidth + delta), ASSISTANT_MAX_WIDTH);
      latestWidth = nextWidth;
      setAssistantWidth(nextWidth);
    }

    function onMouseUp(): void {
      setAssistantResizing(false);
      setAssistantWidth((current) => {
        const resolved = latestWidth || current;
        if (resolved < ASSISTANT_COLLAPSE_THRESHOLD) return 0;
        return Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, resolved));
      });
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  async function fetchWorkspace(): Promise<WorkspaceEnvelope> {
    const response = await apiFetch(`${API_BASE}/api/v1/workspace/current`);
    if (!response.ok) throw new Error(`backend returned ${response.status}`);
    return (await response.json()) as WorkspaceEnvelope;
  }
  const loadWorkspaceSurface = useCallback(async (): Promise<WorkspaceSurfacePayload | null> => {
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/surface`);
      if (!response.ok) return null;
      const payload = (await response.json()) as WorkspaceSurfacePayload;
      setWorkspaceSurface(payload);
      if (!composerGroundingSeededRef.current) {
        setComposerUseGrounding(payload.grounding_default_enabled);
        composerGroundingSeededRef.current = true;
      }
      return payload;
    } catch {
      return null;
    }
  }, []);

  const loadSessionInfo = useCallback(async (): Promise<AuthSessionPayload | null> => {
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/auth/session`);
      if (!response.ok) return null;
      const payload = (await response.json()) as AuthSessionPayload;
      setSessionInfo(payload);
      if (payload.workspace_surface) {
        setWorkspaceSurface(payload.workspace_surface);
        if (!composerGroundingSeededRef.current) {
          setComposerUseGrounding(payload.workspace_surface.grounding_default_enabled);
          composerGroundingSeededRef.current = true;
        }
      }
      return payload;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void loadSessionInfo();
  }, [loadSessionInfo]);

  async function loadSnapshots(): Promise<void> {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graph/snapshots`);
      if (!response.ok) throw new Error(`snapshot list failed with ${response.status}`);
      const payload = (await response.json()) as { items: SnapshotRecord[] };
      setSnapshots(payload.items);
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : copy.errors.loadHistory);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function createGraph(): Promise<void> {
    setCreateGraphLoading(true);
    setCreateGraphError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createGraphDraft),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? `graph create failed with ${response.status}`);
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      clearChatStateForGraph(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      await loadSnapshots();
      setActiveGraphId(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setSelectedTopicId(null);
      setSelectedTopicAnchor(null);
      setCreateGraphOpen(false);
      setCreateGraphDraft({ title: "", subject: "", language: "en", description: "" });
      await loadSessionInfo();
    } catch (createError) {
      setCreateGraphError(createError instanceof Error ? createError.message : copy.errors.createGraph);
    } finally {
      setCreateGraphLoading(false);
    }
  }

  async function importGraphFromPackage(): Promise<void> {
    if (!importGraphPayload) {
      setImportGraphError(copy.dialogs.noFileChosen);
      return;
    }
    setImportGraphLoading(true);
    setImportGraphError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: importGraphPayload,
          title: importGraphTitleDraft.trim() || undefined,
          include_progress: importGraphIncludeProgressDraft,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.importGraph));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      clearChatStateForGraph(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setActiveGraphId(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setSelectedTopicId(null);
      setSelectedTopicAnchor(null);
      closeImportGraphModal();
      setCreateGraphOpen(false);
      await Promise.all([loadSnapshots(), loadSessionInfo()]);
    } catch (importError) {
      setImportGraphError(importError instanceof Error ? importError.message : copy.errors.importGraph);
    } finally {
      setImportGraphLoading(false);
    }
  }

  async function handleImportGraphFile(file: File): Promise<void> {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as GraphExportPackagePayload;
      if (!parsed || parsed.kind !== "mapmind_graph_export" || !parsed.graph) {
        throw new Error("unsupported graph package");
      }
      setImportGraphPayload(parsed);
      setImportGraphFileName(file.name);
      setImportGraphTitleDraft(parsed.title ?? parsed.graph.title ?? "");
      setImportGraphIncludeProgressDraft(Boolean(parsed.include_progress));
      setImportGraphError(null);
    } catch (parseError) {
      setImportGraphPayload(null);
      setImportGraphFileName(file.name);
      setImportGraphError(parseError instanceof Error ? parseError.message : copy.errors.importGraph);
    }
  }

  async function handleObsidianVaultFiles(files: FileList | null): Promise<void> {
    const fileList = files ? Array.from(files) : [];
    if (fileList.length === 0) return;
    setImportObsidianLoading(true);
    setImportObsidianError(null);
    try {
      const relativePaths = fileList
        .map((file) => file.webkitRelativePath || file.name)
        .filter(Boolean);
      const vaultRoot = relativePaths[0]?.split("/")[0] ?? "Obsidian Vault";
      const markdownFiles = fileList.filter((file) => {
        const relativePath = file.webkitRelativePath || file.name;
        return relativePath.toLowerCase().endsWith(".md");
      });
      const entries = await Promise.all(
        markdownFiles.map(async (file) => {
          const relativePath = file.webkitRelativePath || file.name;
          const [, ...segments] = relativePath.split("/");
          return {
            path: segments.join("/") || file.name,
            content: await file.text(),
          } satisfies ObsidianVaultEntry;
        }),
      );
      if (entries.length === 0) {
        throw new Error(copy.dialogs.obsidianNoMarkdown);
      }
      setObsidianVaultName(vaultRoot);
      setObsidianVaultEntries(entries);
      setObsidianImportDraft((current) => ({
        ...current,
        graphTitle: vaultRoot,
        subject: vaultRoot,
      }));
    } catch (loadError) {
      setObsidianVaultName(null);
      setObsidianVaultEntries(null);
      setImportObsidianError(loadError instanceof Error ? loadError.message : copy.errors.importGraph);
    } finally {
      setImportObsidianLoading(false);
    }
  }

  async function importGraphFromObsidian(): Promise<void> {
    if (!obsidianImportPreview?.package) {
      setImportObsidianError(copy.dialogs.obsidianImportBlocked);
      return;
    }
    setImportObsidianLoading(true);
    setImportObsidianError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package: obsidianImportPreview.package,
          title: obsidianImportDraft.graphTitle.trim() || undefined,
          include_progress: false,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.importGraph));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      clearChatStateForGraph(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setActiveGraphId(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setSelectedTopicId(null);
      setSelectedTopicAnchor(null);
      closeImportObsidianModal();
      setCreateGraphOpen(false);
      await Promise.all([loadSnapshots(), loadSessionInfo()]);
    } catch (importError) {
      setImportObsidianError(importError instanceof Error ? importError.message : copy.errors.importGraph);
    } finally {
      setImportObsidianLoading(false);
    }
  }

  async function exportGraph(graph: GraphEnvelope): Promise<void> {
    setExportGraphLoading(true);
    setExportGraphError(null);
    try {
      if (exportGraphFormatDraft === "mapmind_obsidian_export" && !supportsObsidianDirectoryExport()) {
        throw new Error(copy.errors.exportGraphObsidianUnsupported);
      }
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${graph.graph_id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: exportGraphTitleDraft.trim() || graph.title,
          include_progress: exportGraphIncludeProgressDraft,
          format: exportGraphFormatDraft,
          obsidian: exportGraphFormatDraft === "mapmind_obsidian_export" ? exportGraphObsidianOptionsDraft : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.exportGraph));
      }
      if (exportGraphFormatDraft === "mapmind_obsidian_export") {
        const payload = (await response.json()) as ObsidianGraphExportPackagePayload;
        await writeObsidianExportPackageToDirectory(payload);
      } else {
        const payload = (await response.json()) as GraphExportPackagePayload;
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeBase = (exportGraphTitleDraft.trim() || graph.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "graph";
        link.href = objectUrl;
        link.download = `${safeBase}.mapmind-graph.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }
      closeExportGraphModal();
    } catch (exportError) {
      setExportGraphError(exportError instanceof Error ? exportError.message : copy.errors.exportGraph);
    } finally {
      setExportGraphLoading(false);
    }
  }

  async function renameGraph(graphId: string): Promise<void> {
    const nextTitle = renameGraphDraft.trim();
    if (!nextTitle) {
      setError("graph title is required");
      return;
    }
    setRenameGraphSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${graphId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.renameGraph));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      setActiveGraphId(payload.workspace.active_graph_id ?? graphId);
      setRenamingGraphId(null);
      setRenameGraphDraft("");
      await Promise.all([loadSnapshots(), loadSessionInfo()]);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : copy.errors.renameGraph);
    } finally {
      setRenameGraphSaving(false);
    }
  }

  async function saveGraphLayout(): Promise<void> {
    if (!activeGraph) return;
    if (!graphLayoutDraft || Object.keys(graphLayoutDraft).length === 0) {
      setGraphLayoutEditing(false);
      return;
    }
    setGraphLayoutSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${activeGraph.graph_id}/layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: graphLayoutDraft }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.saveGraphLayout));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      setGraphLayoutEditing(false);
      setGraphLayoutDraft(null);
      void loadSnapshots();
    } catch (layoutError) {
      setError(layoutError instanceof Error ? layoutError.message : copy.errors.saveGraphLayout);
    } finally {
      setGraphLayoutSaving(false);
    }
  }

  function startGraphLayoutEdit(): void {
    setError(null);
    setGraphLayoutDraft(activeGraphManualLayout);
    setGraphLayoutEditing(true);
  }

  async function applyProposalFromMessage(messageId: string, proposal: ProposalGenerateResponse): Promise<void> {
    if (!activeGraph) return;
    setApplyLoadingMessageId(messageId);
    setApplyError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proposal.proposal_envelope),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.applyProposal));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      const proposedTopicId = firstProposedTopicId(proposal);
      // Commit the graph transition in one synchronous block to avoid visible intermediate states.
      setData(payload);
      setActiveGraphId(proposal.proposal_envelope.graph_id);
      if (proposedTopicId) {
        setSelectedTopicId(proposedTopicId);
        setSelectedTopicAnchor(null);
      }
      // Snapshot refresh should not block the main graph transition.
      void loadSnapshots();
      try {
        const sessionParam = activeSessionId ? `?session_id=${encodeURIComponent(activeSessionId)}` : "";
        const thread = await markChatProposalApplied(
          apiFetch,
          `${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/chat/messages/${messageId}/applied${sessionParam}`,
          copy.errors.syncAppliedProposal,
        );
        updateCurrentChatState((current) => ({
          ...current,
          messages: thread.messages,
        }));
        setApplyError(null);
      } catch (syncError) {
        setApplyError(syncError instanceof Error ? syncError.message : copy.errors.syncAppliedProposal);
      }
    } catch (applyLoadError) {
      setApplyError(applyLoadError instanceof Error ? applyLoadError.message : copy.errors.applyProposal);
    } finally {
      setApplyLoadingMessageId(null);
    }
  }

  async function startQuiz(): Promise<void> {
    if (!activeGraph || !selectedTopic) return;
    setQuizLoading(true);
    setQuizError(null);
    setQuizSuccess(null);
    setQuizReviews(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/topics/${selectedTopic.id}/quiz/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: data?.workspace.config.default_model ?? null }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.startQuiz));
      }
      const payload = (await response.json()) as QuizStartResponse;
      setQuizSession(payload.session);
      setQuizAnswers({});
    } catch (quizLoadError) {
      setQuizError(quizLoadError instanceof Error ? quizLoadError.message : copy.errors.startQuiz);
    } finally {
      setQuizLoading(false);
    }
  }

  async function markTopicFinished(): Promise<void> {
    if (!activeGraph || !selectedTopic) return;
    setQuizLoading(true);
    setQuizError(null);
    setQuizSuccess(null);
    setQuizReviews(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/topics/${selectedTopic.id}/mark-finished`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.submitQuiz));
      }
      const payload = (await response.json()) as QuizSubmitResponse;
      setData(payload.workspace);
      void loadSnapshots();
      setQuizSession(null);
      setQuizAnswers({});
      setQuizSuccess(copy.closure.markAsFinished);
    } catch (markError) {
      setQuizError(markError instanceof Error ? markError.message : copy.errors.submitQuiz);
    } finally {
      setQuizLoading(false);
    }
  }

  async function addTopicResource(topicId: string, url: string): Promise<void> {
    if (!activeGraph) return;
    const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${activeGraph.graph_id}/topics/${topicId}/resources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, copy.dialogs.addResourceTitle));
    }
    const payload = (await response.json()) as WorkspaceEnvelope;
    setData(payload);
    await loadSnapshots();
  }

  async function addTopicArtifact(topicId: string, title: string, body: string): Promise<void> {
    if (!activeGraph) return;
    const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${activeGraph.graph_id}/topics/${topicId}/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim() }),
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, copy.dialogs.addArtifactTitle));
    }
    const payload = (await response.json()) as WorkspaceEnvelope;
    setData(payload);
    await loadSnapshots();
  }

  async function submitQuiz(): Promise<void> {
    if (!activeGraph || !selectedTopic || !quizSession) return;
    setQuizLoading(true);
    setQuizError(null);
    setQuizSuccess(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/topics/${selectedTopic.id}/quiz/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: quizSession.session_id,
          answers: quizSession.questions.map((question) => ({
            question_id: question.id,
            choice_index: quizAnswers[question.id] ?? -1,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.submitQuiz));
      }
      const payload = (await response.json()) as QuizSubmitResponse;
      setData(payload.workspace);
      void loadSnapshots();
      setQuizAnswers({});
      setQuizReviews(payload.reviews);
      if (payload.attempt.passed) {
        setQuizSuccess(copy.quiz.correct);
      }
    } catch (quizSubmitError) {
      setQuizError(quizSubmitError instanceof Error ? quizSubmitError.message : copy.errors.submitQuiz);
    } finally {
      setQuizLoading(false);
    }
  }

  async function rollbackSnapshot(snapshotId: number): Promise<void> {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graph/rollback/${snapshotId}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, copy.errors.rollbackSnapshot));
      }
      const payload = (await response.json()) as WorkspaceEnvelope;
      setData(payload);
      setActiveGraphId(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      setSelectedTopicId(null);
      setSelectedTopicAnchor(null);
      setQuizSession(null);
      setQuizReviews(null);
      await loadSnapshots();
    } catch (rollbackError) {
      setHistoryError(rollbackError instanceof Error ? rollbackError.message : copy.errors.rollbackSnapshot);
    } finally {
      setHistoryLoading(false);
    }
  }

  const assistantTemplates = [
    { id: "expand", label: copy.graphText.expandGraphAction, value: templatePrompt("expand", copy) },
    { id: "ingest", label: copy.graphText.ingestTopicsAction, value: templatePrompt("ingest", copy) },
  ];
  const suspendedSurfaceStateRef = useRef<{ leftSidebarOpen: boolean; assistantWidth: number } | null>(null);
  const overlayWasOpenRef = useRef(false);
  const [overlayRestoreEpoch, setOverlayRestoreEpoch] = useState(0);
  const assistantOpen = assistantWidth >= ASSISTANT_MIN_WIDTH;
  const hasInlinePlanningWidget = currentChatState.messages.some((message) => Boolean(message.planning_status));
  const overlayLeftOffset = leftSidebarOpen ? 280 : 68;
  const overlayRightOffset = assistantOpen ? assistantWidth + 20 : 56;
  const topOverlayCompact =
    !isMobileViewport
    && viewportWidth - overlayLeftOffset - overlayRightOffset < COMPACT_TOP_OVERLAY_THRESHOLD;

  const openSidebar = useCallback(() => {
    if (sidebarCloseTimerRef.current) {
      window.clearTimeout(sidebarCloseTimerRef.current);
      sidebarCloseTimerRef.current = null;
    }
    setLeftSidebarClosing(false);
    setLeftSidebarOpen(true);
  }, []);

  const closeSidebar = useCallback(() => {
    if (!leftSidebarOpen || leftSidebarClosing) return;
    setLeftSidebarClosing(true);
    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setLeftSidebarOpen(false);
      setLeftSidebarClosing(false);
      sidebarCloseTimerRef.current = null;
    }, 220);
  }, [leftSidebarClosing, leftSidebarOpen]);

  const openConfigurationSettings = useCallback(() => {
    setSettingsOpen((prev) => {
      const next = !prev;
      if (next) setLogsOpen(false);
      return next;
    });
    setMobileMenuOpen(false);
  }, []);

  const toggleDebugLogs = useCallback(() => {
    setLogsOpen((prev) => {
      const next = !prev;
      if (next) setSettingsOpen(false);
      return next;
    });
    setMobileMenuOpen(false);
  }, []);

  const closeOverlaySurfaces = useCallback(() => {
    suspendedSurfaceStateRef.current = null;
    setSettingsOpen(false);
    setLogsOpen(false);
    setMobileMenuOpen(false);
  }, []);

  useEffect(() => {
    const overlayOpen = isSettingsOpen || isLogsOpen;
    if (overlayOpen && !overlayWasOpenRef.current) {
      suspendedSurfaceStateRef.current = {
        leftSidebarOpen,
        assistantWidth,
      };
      if (sidebarCloseTimerRef.current) {
        window.clearTimeout(sidebarCloseTimerRef.current);
        sidebarCloseTimerRef.current = null;
      }
      setLeftSidebarClosing(false);
      setLeftSidebarOpen(false);
      setAssistantWidth(0);
    } else if (!overlayOpen && overlayWasOpenRef.current && suspendedSurfaceStateRef.current) {
      const suspendedState = suspendedSurfaceStateRef.current;
      setLeftSidebarClosing(false);
      setLeftSidebarOpen(suspendedState.leftSidebarOpen);
      setAssistantWidth(suspendedState.assistantWidth);
      suspendedSurfaceStateRef.current = null;
      setOverlayRestoreEpoch((current) => current + 1);
    }
    overlayWasOpenRef.current = overlayOpen;
  }, [assistantWidth, isLogsOpen, isSettingsOpen, leftSidebarOpen]);

  const loadDebugLogs = useCallback(async () => {
    setDebugLogsLoading((current) => current || debugLogs === null);
    if (debugLogs === null) {
      setDebugLogsError(null);
    }
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/debug/logs`);
      if (!response.ok) {
        throw new Error(`debug logs failed with ${response.status}`);
      }
      const payload = (await response.json()) as DebugLogSnapshot;
      setDebugLogs(payload);
      setDebugLogsError(null);
    } catch (loadError) {
      setDebugLogsError(loadError instanceof Error ? loadError.message : "Failed to load debug logs");
    } finally {
      setDebugLogsLoading(false);
    }
  }, [debugLogs]);

  useEffect(() => {
    if (!isLogsOpen || !debugModeEnabled) return;
    void loadDebugLogs();
    const interval = window.setInterval(() => {
      void loadDebugLogs();
    }, 1200);
    return () => window.clearInterval(interval);
  }, [debugModeEnabled, isLogsOpen, loadDebugLogs]);

  const sidebarVisible = leftSidebarOpen || leftSidebarClosing;

  if (!data || !workspaceSurface) {
    return (
      <div className="clewLaunchInline" role="status" aria-label="Loading Clew">
        <ClewLoader size={56} />
      </div>
    );
  }

  return (
    <div className="app" data-theme={themeModeDraft}>
      <div className="ambient-glow" />
      <WorkspaceShell
        copy={copy}
        navigation={{
          sidebarVisible,
          leftSidebarClosing,
          closeSidebar,
          projectsExpanded,
          setProjectsExpanded,
          availableGraphs,
          activeGraph,
          renamingGraphId,
          renameGraphDraft,
          setRenameGraphDraft,
          renameGraphSaving,
          renameGraph,
          setError,
          setRenamingGraphId,
          setActiveGraphId,
          setSelectedTopicId,
          setSelectedTopicAnchor,
          openExportGraphModal,
          setDeleteConfirm,
          setCreateGraphOpen,
          setCreateGraphError,
          mobileMenuOpen,
          setMobileMenuOpen,
        }}
        chrome={{
          openConfigurationSettings,
          openDebugLogs: toggleDebugLogs,
          closeOverlaySurfaces,
          isLogsOpen,
          modalSurfaceLocked: isSettingsOpen || isLogsOpen,
          isMobileViewport,
          leftSidebarOpen,
          openSidebar,
          assistantOpen,
          setAssistantWidth,
          assistantWidth,
          viewportCenteredZoom,
          setViewportCenteredZoom,
          straightEdgeLinesEnabled,
          topOverlayCompact,
          overlayLeftOffset,
          overlayRightOffset,
          floatingStatsRef,
          sessionUser,
          isSettingsOpen,
          debugModeEnabled,
          themeMode: themeModeDraft,
          setThemeMode: setThemeModeDraft,
          overlayRestoreEpoch,
        }}
        workspaceStatus={{
          data,
          assessmentError,
          configSaving,
          error,
          workspaceSurface,
        }}
        graphWorkspace={{
          graphSummary,
          activeAssessmentCards,
          graphLayoutEditing,
          graphLayoutSaving,
          saveGraphLayout,
          startGraphLayoutEdit,
          setGraphLayoutEditing,
          setGraphLayoutDraft,
          graphShellRef,
          focusData,
          handleSelectTopic,
          handleSelectedTopicAnchorChange,
          selectedTopicId,
          graphLayoutDraft,
          activeGraphManualLayout,
          liveDisableIdleAnimations,
          showGraphLoadingState,
          showGraphEmptyState,
          onboardingNeedsFirstGraph,
        }}
        topicDetails={{
          addTopicResource,
          addTopicArtifact,
          selectedTopic,
          selectedTopicAnchor,
          popoverPosition,
          topicPopoverRef,
          popoverDragRef,
          selectedZoneLabel,
          selectedResourceLinks,
          selectedArtifacts,
          selectedClosureStatus,
          topicTitlesById,
          quizError,
          quizSuccess,
          closureTestsEnabled,
          quizLoading,
          startQuiz,
          markTopicFinished,
        }}
        assistant={{
          assistantResizing,
          handleAssistantResize,
          chatSessions,
          activeSessionId,
          setActiveSessionId,
          sessionListWrapRef,
          sessionListRef,
          sessionDragRef,
          apiFetch,
          loadSessions,
          currentChatState,
          chatViewportRef,
          chatThreadLoading,
          hasInlinePlanningWidget,
          chatLoading,
          chatError,
          chatSessionsError,
          updateCurrentChatState,
          sendChat,
          applyLoadingMessageId,
          applyProposalFromMessage,
          setSessionDeleteConfirm,
          applyError,
          assistantTemplates,
          chatModelOptions,
          selectedChatModel,
          setSelectedChatModel,
          composerUseGrounding,
          setComposerUseGrounding,
          chatComposerRef,
        }}
      />

      <SettingsModal
        isSettingsOpen={isSettingsOpen}
        copy={copy}
        setSettingsOpen={setSettingsOpen}
        currentConfig={currentConfig}
        drafts={{
          provider: providerDraft,
          model: modelDraft,
          modelPreset: modelPresetDraft,
          geminiApiKey: geminiApiKeyDraft,
          openaiApiKey: openaiApiKeyDraft,
          openaiBaseUrl: openaiBaseUrlDraft,
          showOpenAIEndpoint: showOpenAIEndpointDraft,
          thinkingMode: thinkingModeDraft,
          plannerMaxTokens: plannerMaxTokensDraft,
          plannerThinkingBudget: plannerThinkingBudgetDraft,
          orchestratorMaxTokens: orchestratorMaxTokensDraft,
          quizMaxTokens: quizMaxTokensDraft,
          assistantMaxTokens: assistantMaxTokensDraft,
          assistantNickname: assistantNicknameDraft,
          persona: personaDraft,
          disableIdleAnimations: disableIdleAnimationsDraft,
          memoryMode: memoryModeDraft,
          memoryHistoryLimit: memoryHistoryLimitDraft,
          memoryIncludeGraphContext: memoryIncludeGraphContextDraft,
          memoryIncludeProgressContext: memoryIncludeProgressContextDraft,
          memoryIncludeQuizContext: memoryIncludeQuizContextDraft,
          memoryIncludeFrontierContext: memoryIncludeFrontierContextDraft,
          memoryIncludeSelectedTopicContext: memoryIncludeSelectedTopicContextDraft,
          enableClosureTests: enableClosureTestsDraft,
          debugModeEnabled: debugModeEnabledDraft,
          straightEdgeLines: straightEdgeLinesDraft,
          themeMode: themeModeDraft,
          quizQuestionCount: quizQuestionCountDraft,
          quizPassCount: quizPassCountDraft,
        }}
        setDrafts={{
          provider: setProviderDraft,
          model: setModelDraft,
          modelPreset: setModelPresetDraft,
          geminiApiKey: setGeminiApiKeyDraft,
          openaiApiKey: setOpenaiApiKeyDraft,
          openaiBaseUrl: setOpenaiBaseUrlDraft,
          showOpenAIEndpoint: setShowOpenAIEndpointDraft,
          thinkingMode: setThinkingModeDraft,
          plannerMaxTokens: setPlannerMaxTokensDraft,
          plannerThinkingBudget: setPlannerThinkingBudgetDraft,
          orchestratorMaxTokens: setOrchestratorMaxTokensDraft,
          quizMaxTokens: setQuizMaxTokensDraft,
          assistantMaxTokens: setAssistantMaxTokensDraft,
          assistantNickname: setAssistantNicknameDraft,
          persona: setPersonaDraft,
          disableIdleAnimations: setDisableIdleAnimationsDraft,
          memoryMode: setMemoryModeDraft,
          memoryHistoryLimit: setMemoryHistoryLimitDraft,
          memoryIncludeGraphContext: setMemoryIncludeGraphContextDraft,
          memoryIncludeProgressContext: setMemoryIncludeProgressContextDraft,
          memoryIncludeQuizContext: setMemoryIncludeQuizContextDraft,
          memoryIncludeFrontierContext: setMemoryIncludeFrontierContextDraft,
          memoryIncludeSelectedTopicContext: setMemoryIncludeSelectedTopicContextDraft,
          enableClosureTests: setEnableClosureTestsDraft,
          debugModeEnabled: setDebugModeEnabledDraft,
          straightEdgeLines: setStraightEdgeLinesDraft,
          themeMode: setThemeModeDraft,
          quizQuestionCount: setQuizQuestionCountDraft,
          quizPassCount: setQuizPassCountDraft,
        }}
        geminiKeyLockedByEnv={geminiKeyLockedByEnv}
        openaiKeyLockedByEnv={openaiKeyLockedByEnv}
        providerOptions={currentConfig?.provider_options ?? ["gemini", "openai"]}
        openaiBaseUrlLockedByEnv={openaiBaseUrlLockedByEnv}
        activeThinkingOption={activeThinkingOption}
        activeThinkingValues={activeThinkingValues}
        activeMemoryOption={activeMemoryOption}
        activeMemoryValues={activeMemoryValues}
        activeGraph={activeGraph}
        loadSnapshots={loadSnapshots}
        historyLoading={historyLoading}
        historyError={historyError}
        snapshots={snapshots}
        data={data}
        rollbackSnapshot={rollbackSnapshot}
        configSaving={configSaving}
        settingsDirty={settingsDirty}
        saveSettings={settingsState.saveSettings}
      />

      <DebugLogsModal
        copy={copy}
        open={isLogsOpen}
        onClose={() => setLogsOpen(false)}
        logs={debugLogs}
        loading={debugLogsLoading}
        error={debugLogsError}
      />

      <AppDialogs
        copy={copy}
        deleteConfirm={deleteConfirm}
        deleteGraphModalRef={deleteGraphModalRef}
        closeDeleteGraphModal={closeDeleteGraphModal}
        deleteGraphCancelButtonRef={deleteGraphCancelButtonRef}
        apiFetch={apiFetch}
        readErrorMessage={readErrorMessage}
        setDeleteConfirm={setDeleteConfirm}
        setData={setData}
        setActiveGraphId={setActiveGraphId}
        clearChatStateForGraph={clearChatStateForGraph}
        loadSnapshots={loadSnapshots}
        loadSessionInfo={loadSessionInfo}
        setError={setError}
        sessionDeleteConfirm={sessionDeleteConfirm}
        sessionDeleteModalRef={sessionDeleteModalRef}
        closeSessionDeleteModal={closeSessionDeleteModal}
        sessionDeleteCancelButtonRef={sessionDeleteCancelButtonRef}
        setSessionDeleteConfirm={setSessionDeleteConfirm}
        activeGraph={activeGraph}
        activeSessionId={activeSessionId}
        setActiveSessionId={setActiveSessionId}
        loadSessions={loadSessions}
        createGraphOpen={createGraphOpen}
        createGraphModalRef={createGraphModalRef}
        closeCreateGraphModal={closeCreateGraphModal}
        createGraphTitleInputRef={createGraphTitleInputRef}
        createGraphDraft={createGraphDraft}
        setCreateGraphDraft={setCreateGraphDraft}
        createGraphError={createGraphError}
        openImportGraphModal={openImportGraphModal}
        openImportObsidianModal={openImportObsidianModal}
        createGraphLoading={createGraphLoading}
        createGraph={createGraph}
        importGraphOpen={importGraphOpen}
        importGraphModalRef={importGraphModalRef}
        closeImportGraphModal={closeImportGraphModal}
        importGraphFileInputRef={importGraphFileInputRef}
        importGraphFileButtonRef={importGraphFileButtonRef}
        handleImportGraphFile={handleImportGraphFile}
        importGraphFileName={importGraphFileName}
        importGraphPayload={importGraphPayload}
        importGraphTitleDraft={importGraphTitleDraft}
        setImportGraphTitleDraft={setImportGraphTitleDraft}
        importGraphIncludeProgressDraft={importGraphIncludeProgressDraft}
        setImportGraphIncludeProgressDraft={setImportGraphIncludeProgressDraft}
        importGraphError={importGraphError}
        importGraphLoading={importGraphLoading}
        importGraphFromPackage={importGraphFromPackage}
        importObsidianOpen={importObsidianOpen}
        importObsidianModalRef={importObsidianModalRef}
        closeImportObsidianModal={closeImportObsidianModal}
        importObsidianFolderInputRef={importObsidianFolderInputRef}
        importObsidianFolderButtonRef={importObsidianFolderButtonRef}
        handleObsidianVaultFiles={handleObsidianVaultFiles}
        obsidianVaultName={obsidianVaultName}
        obsidianImportDraft={obsidianImportDraft}
        setObsidianImportDraft={setObsidianImportDraft}
        obsidianImportPreview={obsidianImportPreview}
        importObsidianError={importObsidianError}
        importObsidianLoading={importObsidianLoading}
        importGraphFromObsidian={importGraphFromObsidian}
        exportGraphTarget={exportGraphTarget}
        exportGraphModalRef={exportGraphModalRef}
        closeExportGraphModal={closeExportGraphModal}
        exportGraphTitleInputRef={exportGraphTitleInputRef}
        exportGraphTitleDraft={exportGraphTitleDraft}
        setExportGraphTitleDraft={setExportGraphTitleDraft}
        exportGraphIncludeProgressDraft={exportGraphIncludeProgressDraft}
        setExportGraphIncludeProgressDraft={setExportGraphIncludeProgressDraft}
        exportGraphFormatDraft={exportGraphFormatDraft}
        setExportGraphFormatDraft={setExportGraphFormatDraft}
        exportGraphObsidianOptionsDraft={exportGraphObsidianOptionsDraft}
        setExportGraphObsidianOptionsDraft={setExportGraphObsidianOptionsDraft}
        exportGraphError={exportGraphError}
        exportGraphLoading={exportGraphLoading}
        exportGraph={exportGraph}
        quizSession={quizSession}
        quizModalRef={quizModalRef}
        quizCloseButtonRef={quizCloseButtonRef}
        selectedTopic={selectedTopic}
        closeQuizModal={closeQuizModal}
        quizError={quizError}
        quizReviews={quizReviews}
        quizAnswers={quizAnswers}
        setQuizAnswers={setQuizAnswers}
        quizLoading={quizLoading}
        submitQuiz={submitQuiz}
      />
    </div>
  );
}
