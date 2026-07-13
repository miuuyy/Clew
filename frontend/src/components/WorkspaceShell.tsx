import React from "react";
import { BookBookmark, BugBeetle, CaretDown, CaretLeft, CaretRight, ChatCircleDots, Check, CrosshairSimple, DownloadSimple, GearSix, List, PencilSimple, SquaresFour } from "@phosphor-icons/react";

import { APP_NAME, ASSISTANT_MIN_WIDTH, type AuthSessionPayload, type GraphChatState, type ThemeMode, type WorkspaceSurfacePayload } from "../lib/appContracts";
import { API_BASE } from "../lib/api";
import {
  LIGHT_DESKTOP_LAYOUT_STORAGE_KEY,
  clampFloatingPosition,
  canPlaceFloatingRect,
  computeCanonicalLightDesktopLayout,
  makeFloatingRect,
  readStoredLightDesktopLayout,
  toFloatingRect,
  type FloatingRect,
  type FloatingWindowDragTarget,
  type FloatingWindowPosition,
  type StoredLightDesktopLayout,
} from "../lib/floatingDesktopLayout";
import { renderDisplayText, safeExternalUrl, userInitials, type ManualLayoutPositions, type PopoverPosition, type apiFetch } from "../lib/appUiHelpers";
import type { AppCopy } from "../lib/appCopy";
import { formatMinutes, formatTopicState } from "../lib/graph";
import { useModalAccessibility } from "../lib/useModalAccessibility";
import { GraphCanvas } from "./GraphCanvas";
import type { TopicAnchorPoint } from "./GraphCanvas";
import { AssistantModelMenuTrigger, LightChatWindow, LightWorkspaceWindow, TopicAssetModal } from "./WorkspaceShellAuxWindows";
import { AssistantComposer } from "./assistant/AssistantComposer";
import { AssistantSessionList } from "./assistant/AssistantSessionList";
import { AssistantThread } from "./assistant/AssistantThread";
import { ClewLoader } from "./ClewLoader";
import { TopStatsOverlay } from "./TopStatsOverlay";
import type { GraphViewMode } from "./WorkspaceShellOverlayControls";
import type {
  Artifact,
  ChatMessage,
  ChatSessionSummary,
  GraphAssessment,
  GraphEnvelope,
  ProposalGenerateResponse,
  ResourceLink,
  Topic,
  TopicClosureStatus,
  WorkspaceEnvelope,
} from "../lib/types";

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;

  const noop = () => {};
  const LIGHT_WORKSPACE_EXPANDED_GRAPH_STORAGE_KEY = "knowledge_graph_light_workspace_expanded_graph_v1";
const GRAPH_VIEW_MODE_STORAGE_KEY = "knowledge_graph_view_mode_v1";

// Keep closing windows mounted briefly so the exit animation can complete.
const WINDOW_CLOSE_MS = 110;
const Graph3DCanvas = React.lazy(() => import("./Graph3DCanvas").then((module) => ({ default: module.Graph3DCanvas })));

function useDelayedUnmount(isOpen: boolean, delayMs: number): { rendered: boolean; closing: boolean } {
  const [rendered, setRendered] = React.useState<boolean>(isOpen);
  const [closing, setClosing] = React.useState<boolean>(false);
  React.useEffect(() => {
    if (isOpen) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, delayMs, rendered]);
  return { rendered, closing };
}

type GraphSummary = {
  topicCount: number;
  completedPercent: number;
  completedCount: number;
  reviewCount: number;
};

type FocusData = {
  rootIds: Set<string>;
  ancestorIds: Set<string>;
  pathNodeIds: Set<string>;
  pathEdgeIds: Set<string>;
  frontierEdgeIds: Set<string>;
  pathLayers: Array<Array<{ id: string; title: string }>>;
};

type AssistantTemplate = {
  id: string;
  label: string;
  value: string;
};

type WorkspaceNavigationProps = {
  sidebarVisible: boolean;
  leftSidebarClosing: boolean;
  closeSidebar: () => void;
  projectsExpanded: boolean;
  setProjectsExpanded: StateSetter<boolean>;
  availableGraphs: GraphEnvelope[];
  activeGraph: GraphEnvelope | null;
  renamingGraphId: string | null;
  renameGraphDraft: string;
  setRenameGraphDraft: StateSetter<string>;
  renameGraphSaving: boolean;
  renameGraph: (graphId: string) => Promise<void>;
  setError: StateSetter<string | null>;
  setRenamingGraphId: StateSetter<string | null>;
  setActiveGraphId: StateSetter<string | null>;
  setSelectedTopicId: StateSetter<string | null>;
  setSelectedTopicAnchor: StateSetter<TopicAnchorPoint | null>;
  openExportGraphModal: (graph: GraphEnvelope) => void;
  setDeleteConfirm: StateSetter<{ graphId: string; title: string } | null>;
  setCreateGraphOpen: StateSetter<boolean>;
  setCreateGraphError: StateSetter<string | null>;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: StateSetter<boolean>;
};

type WorkspaceChromeProps = {
  openConfigurationSettings: () => void;
  openDebugLogs: () => void;
  closeOverlaySurfaces: () => void;
  isLogsOpen: boolean;
  modalSurfaceLocked: boolean;
  isMobileViewport: boolean;
  leftSidebarOpen: boolean;
  openSidebar: () => void;
  assistantOpen: boolean;
  setAssistantWidth: StateSetter<number>;
  assistantWidth: number;
  viewportCenteredZoom: boolean;
  setViewportCenteredZoom: StateSetter<boolean>;
  straightEdgeLinesEnabled: boolean;
  topOverlayCompact: boolean;
  overlayLeftOffset: number;
  overlayRightOffset: number;
  floatingStatsRef: React.RefObject<HTMLDivElement | null>;
  sessionUser: AuthSessionPayload["user"];
  isSettingsOpen: boolean;
  debugModeEnabled: boolean;
  themeMode: ThemeMode;
  setThemeMode: StateSetter<ThemeMode>;
  overlayRestoreEpoch: number;
};

type WorkspaceStatusProps = {
  data: WorkspaceEnvelope | null;
  assessmentError: string | null;
  configSaving: boolean;
  error: string | null;
  workspaceSurface: WorkspaceSurfacePayload | null;
};

type GraphWorkspaceProps = {
  graphSummary: GraphSummary;
  activeAssessmentCards: GraphAssessment["cards"];
  graphLayoutEditing: boolean;
  graphLayoutSaving: boolean;
  saveGraphLayout: () => Promise<void>;
  startGraphLayoutEdit: () => void;
  setGraphLayoutEditing: StateSetter<boolean>;
  setGraphLayoutDraft: StateSetter<ManualLayoutPositions | null>;
  graphShellRef: React.RefObject<HTMLDivElement | null>;
  focusData: FocusData;
  handleSelectTopic: (topicId: string | null, anchor: TopicAnchorPoint | null) => void;
  handleSelectedTopicAnchorChange: (next: TopicAnchorPoint | null) => void;
  selectedTopicId: string | null;
  graphLayoutDraft: ManualLayoutPositions | null;
  activeGraphManualLayout: ManualLayoutPositions | null;
  liveDisableIdleAnimations: boolean;
  showGraphLoadingState: boolean;
  showGraphEmptyState: boolean;
  onboardingNeedsFirstGraph: boolean;
};

type TopicDetailsProps = {
  addTopicResource: (topicId: string, url: string) => Promise<void>;
  addTopicArtifact: (topicId: string, title: string, body: string) => Promise<void>;
  selectedTopic: Topic | null;
  selectedTopicAnchor: TopicAnchorPoint | null;
  popoverPosition: PopoverPosition | null;
  topicPopoverRef: React.RefObject<HTMLDivElement | null>;
  popoverDragRef: React.MutableRefObject<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>;
  selectedZoneLabel: string;
  selectedResourceLinks: ResourceLink[];
  selectedArtifacts: Artifact[];
  selectedClosureStatus: TopicClosureStatus | null;
  topicTitlesById: Map<string, string>;
  quizError: string | null;
  quizSuccess: string | null;
  closureTestsEnabled: boolean;
  quizLoading: boolean;
  startQuiz: () => Promise<void>;
  markTopicFinished: () => Promise<void>;
};

type AssistantWorkspaceProps = {
  assistantResizing: boolean;
  handleAssistantResize: (startX: number) => void;
  chatSessions: ChatSessionSummary[];
  activeSessionId: string | null;
  setActiveSessionId: StateSetter<string | null>;
  sessionListWrapRef: React.RefObject<HTMLDivElement | null>;
  sessionListRef: React.RefObject<HTMLDivElement | null>;
  sessionDragRef: React.MutableRefObject<{ startX: number; scrollLeft: number } | null>;
  apiFetch: typeof apiFetch;
  loadSessions: () => Promise<void>;
  currentChatState: GraphChatState;
  chatViewportRef: React.RefObject<HTMLDivElement | null>;
  chatThreadLoading: boolean;
  hasInlinePlanningWidget: boolean;
  chatLoading: boolean;
  chatError: string | null;
  chatSessionsError: string | null;
  updateCurrentChatState: (updater: (current: GraphChatState) => GraphChatState) => void;
  sendChat: (overridePrompt?: string, options?: { hiddenUserMessage?: boolean; baseMessages?: ChatMessage[] }) => Promise<void>;
  applyLoadingMessageId: string | null;
  applyProposalFromMessage: (messageId: string, proposal: ProposalGenerateResponse) => Promise<void>;
  setSessionDeleteConfirm: StateSetter<{ sessionId: string; title: string } | null>;
  applyError: string | null;
  assistantTemplates: AssistantTemplate[];
  chatModelOptions: string[];
  selectedChatModel: string | null;
  setSelectedChatModel: StateSetter<string | null>;
  composerUseGrounding: boolean;
  setComposerUseGrounding: StateSetter<boolean>;
  chatComposerRef: React.RefObject<HTMLTextAreaElement | null>;
};

type WorkspaceShellProps = {
  copy: AppCopy;
  navigation: WorkspaceNavigationProps;
  chrome: WorkspaceChromeProps;
  workspaceStatus: WorkspaceStatusProps;
  graphWorkspace: GraphWorkspaceProps;
  topicDetails: TopicDetailsProps;
  assistant: AssistantWorkspaceProps;
};

export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const {
    copy,
    navigation,
    chrome,
    workspaceStatus,
    graphWorkspace,
    topicDetails,
    assistant,
  } = props;
  const {
    sidebarVisible,
    leftSidebarClosing,
    closeSidebar,
    projectsExpanded,
    setProjectsExpanded,
    availableGraphs,
    activeGraph,
    setError,
    renamingGraphId,
    renameGraphDraft,
    setRenameGraphDraft,
    renameGraphSaving,
    renameGraph,
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
  } = navigation;
  const {
    openConfigurationSettings,
    openDebugLogs,
    closeOverlaySurfaces,
    isLogsOpen,
    modalSurfaceLocked,
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
    themeMode,
    setThemeMode,
    overlayRestoreEpoch,
  } = chrome;
  const {
    data,
    assessmentError,
    configSaving,
    error,
    workspaceSurface,
  } = workspaceStatus;
  const {
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
  } = graphWorkspace;
  const {
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
  } = topicDetails;
  const {
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
  } = assistant;
  const assistantDisplayName = data?.workspace.config.assistant_nickname?.trim() || copy.sessions.assistantTitle;
  const experimentalLightDesktop = !isMobileViewport;
  const shellSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const dockRef = React.useRef<HTMLDivElement | null>(null);
  const workspaceWindowRef = React.useRef<HTMLDivElement | null>(null);
  const chatWindowRef = React.useRef<HTMLDivElement | null>(null);
  const dragStateRef = React.useRef<{
    target: FloatingWindowDragTarget;
    origin: FloatingWindowPosition;
    lastValid: FloatingWindowPosition;
    startPointerX: number;
    startPointerY: number;
    shellRect: DOMRect;
    size: { width: number; height: number };
  } | null>(null);
  const storedLightDesktopLayout = React.useMemo(() => readStoredLightDesktopLayout(), []);
  const hadStoredLightDesktopLayoutRef = React.useRef(Boolean(storedLightDesktopLayout));
  const lightDesktopLayoutInitializedRef = React.useRef(false);
  const prevLightWorkspacePanelOpenRef = React.useRef(false);
  const prevLightChatPanelOpenRef = React.useRef(false);
  const lastOverlayRestoreEpochRef = React.useRef(overlayRestoreEpoch);
  const [dockPosition, setDockPosition] = React.useState<FloatingWindowPosition>(() => storedLightDesktopLayout?.dock ?? { x: 18, y: 82 });
  const [workspaceWindowPosition, setWorkspaceWindowPosition] = React.useState<FloatingWindowPosition>(() => storedLightDesktopLayout?.workspace ?? { x: 92, y: 86 });
  const [chatWindowPosition, setChatWindowPosition] = React.useState<FloatingWindowPosition>(() => storedLightDesktopLayout?.chat ?? { x: 0, y: 84 });
  const [lightWorkspaceExpandedGraphId, setLightWorkspaceExpandedGraphId] = React.useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(LIGHT_WORKSPACE_EXPANDED_GRAPH_STORAGE_KEY);
      return stored && stored.trim() ? stored : null;
    } catch {
      return null;
    }
  });
  const [graphViewMode, setGraphViewMode] = React.useState<GraphViewMode>(() => {
    try {
      return localStorage.getItem(GRAPH_VIEW_MODE_STORAGE_KEY) === "3d" ? "3d" : "2d";
    } catch {
      return "2d";
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(GRAPH_VIEW_MODE_STORAGE_KEY, graphViewMode);
    } catch {
      // Storage is optional; the selected renderer still works for this session.
    }
  }, [graphViewMode]);
  const showMobileOverlay = isMobileViewport && !isSettingsOpen;
  const showCompactDesktopOverlay = topOverlayCompact && !isMobileViewport && !isSettingsOpen;
  const showInlineDesktopOverlay = !topOverlayCompact && !isMobileViewport && !isSettingsOpen;
  const lightWorkspacePanelOpen = experimentalLightDesktop && leftSidebarOpen;
  const lightChatPanelOpen = experimentalLightDesktop && assistantOpen;
  const overlayLeftInset = experimentalLightDesktop ? 104 : overlayLeftOffset;
  const overlayRightInset = experimentalLightDesktop ? 24 : overlayRightOffset;
  const getDockIconWeight = React.useCallback(
    (isActive: boolean) => {
      if (themeMode === "dark") return "regular";
      return isActive ? "regular" : "duotone";
    },
    [themeMode],
  );

  const graphCanvasBackgroundFill = themeMode === "light" ? "#f7f7f4" : "#000000";
  const [topicAssetDialog, setTopicAssetDialog] = React.useState<{
    kind: "resource" | "artifact";
    topicId: string;
    topicTitle: string;
  } | null>(null);
  const [topicAssetSaving, setTopicAssetSaving] = React.useState(false);
  const [topicAssetError, setTopicAssetError] = React.useState<string | null>(null);
  const [topicResourceUrlDraft, setTopicResourceUrlDraft] = React.useState("");
  const [topicArtifactTitleDraft, setTopicArtifactTitleDraft] = React.useState("");
  const [topicArtifactBodyDraft, setTopicArtifactBodyDraft] = React.useState("");
  const topicAssetModalRef = React.useRef<HTMLDivElement | null>(null);
  const topicAssetPrimaryInputRef = React.useRef<HTMLElement | null>(null);
  // Prevent repeated pointer events from creating duplicate topic chat sessions.
  const createTopicSessionPendingRef = React.useRef(false);
  const closeTopicAssetModal = React.useCallback(() => {
    setTopicAssetDialog(null);
    setTopicAssetSaving(false);
    setTopicAssetError(null);
    setTopicResourceUrlDraft("");
    setTopicArtifactTitleDraft("");
    setTopicArtifactBodyDraft("");
  }, []);
  useModalAccessibility({
    isOpen: Boolean(topicAssetDialog),
    modalRef: topicAssetModalRef,
    onClose: closeTopicAssetModal,
    initialFocusRef: topicAssetPrimaryInputRef,
  });
  React.useEffect(() => {
    closeTopicAssetModal();
  }, [closeTopicAssetModal, selectedTopic?.id]);

  const beginFloatingDrag = React.useCallback((target: FloatingWindowDragTarget, event: React.PointerEvent<HTMLElement>) => {
    if (!experimentalLightDesktop) return;
    const shell = shellSurfaceRef.current;
    const targetElement = target === "dock" ? dockRef.current : target === "workspace" ? workspaceWindowRef.current : chatWindowRef.current;
    if (!shell || !targetElement) return;
    const shellRect = shell.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const origin = target === "dock" ? dockPosition : target === "workspace" ? workspaceWindowPosition : chatWindowPosition;
    dragStateRef.current = {
      target,
      origin,
      lastValid: origin,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      shellRect,
      size: { width: targetRect.width, height: targetRect.height },
    };
    document.body.style.userSelect = "none";
    event.preventDefault();
  }, [chatWindowPosition, dockPosition, experimentalLightDesktop, workspaceWindowPosition]);

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const nextPosition = {
        x: drag.origin.x + (event.clientX - drag.startPointerX),
        y: drag.origin.y + (event.clientY - drag.startPointerY),
      };
      const blockedRects: FloatingRect[] = [];

      // Only visible stat chips block floating-window drag targets.
      const statsContainer = floatingStatsRef.current;
      if (statsContainer) {
        for (const child of Array.from(statsContainer.children) as HTMLElement[]) {
          const rect = child.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            blockedRects.push(toFloatingRect(drag.shellRect, rect));
          }
        }
      }
      // Topic popovers do not block floating windows.

      const clampedCandidate = clampFloatingPosition(drag.target, nextPosition, drag.size, drag.shellRect);
      const candidateRect = makeFloatingRect(clampedCandidate, drag.size);
      const xOnlyCandidate = { x: clampedCandidate.x, y: drag.lastValid.y };
      const yOnlyCandidate = { x: drag.lastValid.x, y: clampedCandidate.y };
      const xOnlyRect = makeFloatingRect(xOnlyCandidate, drag.size);
      const yOnlyRect = makeFloatingRect(yOnlyCandidate, drag.size);
      let resolved = drag.lastValid;

      if (canPlaceFloatingRect(candidateRect, blockedRects)) {
        resolved = clampedCandidate;
      } else if (canPlaceFloatingRect(xOnlyRect, blockedRects)) {
        resolved = xOnlyCandidate;
      } else if (canPlaceFloatingRect(yOnlyRect, blockedRects)) {
        resolved = yOnlyCandidate;
      }
      drag.lastValid = resolved;

      if (drag.target === "workspace") {
        setWorkspaceWindowPosition(resolved);
      } else if (drag.target === "chat") {
        setChatWindowPosition(resolved);
      } else if (drag.target === "dock") {
        setDockPosition(resolved);
      }
    };
    const handlePointerUp = () => {
      dragStateRef.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [floatingStatsRef, lightChatPanelOpen, lightWorkspacePanelOpen, popoverPosition, selectedTopic, topicPopoverRef]);

  const applyCanonicalLightDesktopLayout = React.useCallback(() => {
    if (!experimentalLightDesktop) return;
    const shell = shellSurfaceRef.current;
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    const dockRect = dockRef.current?.getBoundingClientRect();
    const workspaceRect = workspaceWindowRef.current?.getBoundingClientRect();
    const chatRect = chatWindowRef.current?.getBoundingClientRect();
    const dockSize = dockRect ? { width: dockRect.width, height: dockRect.height } : { width: 72, height: 320 };
    const workspaceSize = workspaceRect ? { width: workspaceRect.width, height: workspaceRect.height } : { width: 400, height: 520 };
    const chatSize = chatRect ? { width: chatRect.width, height: chatRect.height } : { width: Math.min(Math.max(assistantWidth, 390), 460), height: 760 };
    const next = computeCanonicalLightDesktopLayout(shellRect, dockSize, workspaceSize, chatSize);
    setDockPosition(next.dock);
    setWorkspaceWindowPosition(next.workspace);
    setChatWindowPosition(next.chat);
  }, [assistantWidth, experimentalLightDesktop]);

  React.useLayoutEffect(() => {
    if (!experimentalLightDesktop) {
      lightDesktopLayoutInitializedRef.current = false;
      prevLightWorkspacePanelOpenRef.current = false;
      prevLightChatPanelOpenRef.current = false;
      return;
    }
    if (lightDesktopLayoutInitializedRef.current) return;
    if (!hadStoredLightDesktopLayoutRef.current) {
      applyCanonicalLightDesktopLayout();
    }
    lightDesktopLayoutInitializedRef.current = true;
  }, [applyCanonicalLightDesktopLayout, experimentalLightDesktop]);

  React.useLayoutEffect(() => {
    if (!experimentalLightDesktop) return;
    // Preserve user-adjusted floating-window positions across overlay toggles.
    lastOverlayRestoreEpochRef.current = overlayRestoreEpoch;
    prevLightWorkspacePanelOpenRef.current = lightWorkspacePanelOpen;
    prevLightChatPanelOpenRef.current = lightChatPanelOpen;
  }, [
    experimentalLightDesktop,
    lightChatPanelOpen,
    lightWorkspacePanelOpen,
    overlayRestoreEpoch,
  ]);

  React.useLayoutEffect(() => {
    if (!experimentalLightDesktop) return;
    const shell = shellSurfaceRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    setDockPosition((current) => ({
      x: Math.min(Math.max(18, current.x), Math.max(18, rect.width - 92)),
      y: Math.min(Math.max(72, current.y), Math.max(18, rect.height - 360)),
    }));
    setWorkspaceWindowPosition((current) => ({
      x: Math.min(Math.max(104, current.x), Math.max(24, rect.width - 428)),
      y: Math.min(Math.max(84, current.y), Math.max(24, rect.height - 420)),
    }));
    setChatWindowPosition((current) => {
      const defaultX = Math.max(180, rect.width - Math.min(Math.max(assistantWidth, 390), 460) - 28);
      return {
        x: Math.min(Math.max(180, current.x || defaultX), Math.max(40, rect.width - 470)),
        y: Math.min(Math.max(76, current.y), Math.max(24, rect.height - 560)),
      };
    });
  }, [assistantWidth, experimentalLightDesktop]);

  React.useLayoutEffect(() => {
    if (!experimentalLightDesktop) return;
    const shell = shellSurfaceRef.current;
    if (!shell) return;
    const shellRect = shell.getBoundingClientRect();
    const dockRect = dockRef.current?.getBoundingClientRect();
    const workspaceRect = workspaceWindowRef.current?.getBoundingClientRect();
    const chatRect = chatWindowRef.current?.getBoundingClientRect();

    const dockSize = dockRect ? { width: dockRect.width, height: dockRect.height } : { width: 72, height: 320 };
    const workspaceSize = workspaceRect ? { width: workspaceRect.width, height: workspaceRect.height } : { width: 400, height: 520 };
    const chatSize = chatRect ? { width: chatRect.width, height: chatRect.height } : { width: Math.min(Math.max(assistantWidth, 390), 460), height: 760 };

    const nextDockPosition = clampFloatingPosition("dock", dockPosition, dockSize, shellRect);
    const nextWorkspacePosition = lightWorkspacePanelOpen
      ? clampFloatingPosition("workspace", workspaceWindowPosition, workspaceSize, shellRect)
      : workspaceWindowPosition;
    const nextChatPosition = lightChatPanelOpen
      ? clampFloatingPosition("chat", chatWindowPosition, chatSize, shellRect)
      : chatWindowPosition;

    if (nextDockPosition.x !== dockPosition.x || nextDockPosition.y !== dockPosition.y) {
      setDockPosition(nextDockPosition);
    }
    if (nextWorkspacePosition.x !== workspaceWindowPosition.x || nextWorkspacePosition.y !== workspaceWindowPosition.y) {
      setWorkspaceWindowPosition(nextWorkspacePosition);
    }
    if (nextChatPosition.x !== chatWindowPosition.x || nextChatPosition.y !== chatWindowPosition.y) {
      setChatWindowPosition(nextChatPosition);
    }
  }, [
    assistantWidth,
    chatWindowPosition,
    dockPosition,
    experimentalLightDesktop,
    floatingStatsRef,
    lightChatPanelOpen,
    lightWorkspacePanelOpen,
    overlayLeftOffset,
    overlayRightOffset,
    popoverPosition,
    selectedTopic,
    topicPopoverRef,
    workspaceWindowPosition,
  ]);

  React.useEffect(() => {
    if (!experimentalLightDesktop) return;
    try {
      localStorage.setItem(
        LIGHT_DESKTOP_LAYOUT_STORAGE_KEY,
        JSON.stringify({
          dock: dockPosition,
          workspace: workspaceWindowPosition,
          chat: chatWindowPosition,
        } satisfies StoredLightDesktopLayout),
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [chatWindowPosition, dockPosition, experimentalLightDesktop, workspaceWindowPosition]);
  const activeSession = activeSessionId
    ? chatSessions.find((session) => session.session_id === activeSessionId) ?? null
    : null;
  const generalSession = chatSessions.find((session) => !session.topic_id) ?? null;
  const topicSessions = chatSessions.filter((session) => Boolean(session.topic_id));
  const visibleMessages = currentChatState.messages.filter((message) => !message.hidden);
  const pathTitles = focusData.pathLayers.flat().map((entry) => entry.title);
  const selectedTopicClosed = selectedTopic?.state === "solid" || selectedTopic?.state === "mastered";
  const topicPopoverConnector = React.useMemo(() => {
    if (graphViewMode !== "3d" || !selectedTopic || !selectedTopicAnchor || !popoverPosition || isMobileViewport) return null;
    const width = topicPopoverRef.current?.offsetWidth ?? 380;
    const height = topicPopoverRef.current?.offsetHeight ?? 320;
    const left = popoverPosition.left;
    const top = popoverPosition.top;
    const right = left + width;
    const bottom = top + height;
    const anchorInsidePopover = selectedTopicAnchor.x >= left
      && selectedTopicAnchor.x <= right
      && selectedTopicAnchor.y >= top
      && selectedTopicAnchor.y <= bottom;
    if (anchorInsidePopover) return null;

    const exitsLeft = selectedTopicAnchor.x < left;
    const startX = exitsLeft ? left - 2 : right + 2;
    const startY = top + height / 2;
    const direction = selectedTopicAnchor.x >= startX ? 1 : -1;
    const horizontalDistance = Math.abs(selectedTopicAnchor.x - startX);
    const bend = Math.max(36, Math.min(150, horizontalDistance * 0.42));
    const path = [
      `M ${startX} ${startY}`,
      `C ${startX + direction * bend} ${startY},`,
      `${selectedTopicAnchor.x - direction * bend * 0.52} ${selectedTopicAnchor.y},`,
      `${selectedTopicAnchor.x} ${selectedTopicAnchor.y}`,
    ].join(" ");
    return { path };
  }, [graphViewMode, isMobileViewport, popoverPosition, selectedTopic, selectedTopicAnchor, topicPopoverRef]);

  React.useEffect(() => {
    if (!experimentalLightDesktop) return;
    if (!activeGraph?.graph_id) return;
    setLightWorkspaceExpandedGraphId((current) => current ?? activeGraph.graph_id);
  }, [activeGraph?.graph_id, experimentalLightDesktop]);

  React.useEffect(() => {
    if (!experimentalLightDesktop) return;
    if (!lightWorkspaceExpandedGraphId) return;
    if (availableGraphs.some((graph) => graph.graph_id === lightWorkspaceExpandedGraphId)) return;
    setLightWorkspaceExpandedGraphId(activeGraph?.graph_id ?? null);
  }, [activeGraph?.graph_id, availableGraphs, experimentalLightDesktop, lightWorkspaceExpandedGraphId]);

  React.useEffect(() => {
    if (!experimentalLightDesktop) return;
    try {
      if (lightWorkspaceExpandedGraphId) {
        localStorage.setItem(LIGHT_WORKSPACE_EXPANDED_GRAPH_STORAGE_KEY, lightWorkspaceExpandedGraphId);
      } else {
        localStorage.removeItem(LIGHT_WORKSPACE_EXPANDED_GRAPH_STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage write failures.
    }
  }, [experimentalLightDesktop, lightWorkspaceExpandedGraphId]);

  function openTopicAssetDialog(kind: "resource" | "artifact"): void {
    if (!selectedTopic) return;
    setTopicAssetDialog({ kind, topicId: selectedTopic.id, topicTitle: selectedTopic.title });
    setTopicAssetError(null);
    setTopicAssetSaving(false);
    setTopicResourceUrlDraft("");
    setTopicArtifactTitleDraft("");
    setTopicArtifactBodyDraft("");
  }

  async function submitTopicAssetDialog(): Promise<void> {
    if (!topicAssetDialog) return;
    setTopicAssetSaving(true);
    setTopicAssetError(null);
    try {
      if (topicAssetDialog.kind === "resource") {
        const safeUrl = safeExternalUrl(topicResourceUrlDraft);
        if (!safeUrl) {
          throw new Error("A valid link is required.");
        }
        await addTopicResource(topicAssetDialog.topicId, safeUrl);
      } else {
        await addTopicArtifact(topicAssetDialog.topicId, topicArtifactTitleDraft, topicArtifactBodyDraft);
      }
      closeTopicAssetModal();
    } catch (assetError) {
      setTopicAssetError(assetError instanceof Error ? assetError.message : copy.errors.updateConfig);
    } finally {
      setTopicAssetSaving(false);
    }
  }

  const toggleExperimentalWorkspaceWindow = (): void => {
    if (modalSurfaceLocked) {
      closeOverlaySurfaces();
    }
    if (leftSidebarOpen) {
      closeSidebar();
      return;
    }
    openSidebar();
  };

  const toggleExperimentalChatWindow = (): void => {
    if (modalSurfaceLocked) {
      closeOverlaySurfaces();
    }
    if (assistantOpen) {
      setAssistantWidth(0);
      return;
    }
    setAssistantWidth((current) => (current < ASSISTANT_MIN_WIDTH ? 390 : current));
  };

  const workspaceWindowAnim = useDelayedUnmount(lightWorkspacePanelOpen, WINDOW_CLOSE_MS);
  const lightWorkspaceWindow = workspaceWindowAnim.rendered ? (
    <LightWorkspaceWindow
      workspaceWindowRef={workspaceWindowRef}
      workspaceWindowPosition={workspaceWindowPosition}
      beginFloatingDrag={beginFloatingDrag}
      copy={copy}
      availableGraphs={availableGraphs}
      setCreateGraphOpen={setCreateGraphOpen}
      setCreateGraphError={setCreateGraphError}
      activeGraph={activeGraph}
      lightWorkspaceExpandedGraphId={lightWorkspaceExpandedGraphId}
      setLightWorkspaceExpandedGraphId={setLightWorkspaceExpandedGraphId}
      setActiveGraphId={setActiveGraphId}
      setSelectedTopicId={setSelectedTopicId}
      setSelectedTopicAnchor={setSelectedTopicAnchor}
      renamingGraphId={renamingGraphId}
      renameGraphDraft={renameGraphDraft}
      setRenameGraphDraft={setRenameGraphDraft}
      renameGraph={renameGraph}
      setRenamingGraphId={setRenamingGraphId}
      setError={setError}
      renameGraphSaving={renameGraphSaving}
      openExportGraphModal={openExportGraphModal}
      setDeleteConfirm={setDeleteConfirm}
      selectedTopicId={selectedTopicId}
      handleSelectTopic={handleSelectTopic}
      closing={workspaceWindowAnim.closing}
    />
  ) : null;
  async function createTopicSession(): Promise<void> {
    if (!activeGraph || !selectedTopicId || !selectedTopic) return;
    if (createTopicSessionPendingRef.current) return;
    createTopicSessionPendingRef.current = true;
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/chat/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: selectedTopicId, title: selectedTopic.title }),
      });
      if (!response.ok) return;
      const session = await response.json();
      setActiveSessionId(session.session_id);
      void loadSessions();
    } finally {
      createTopicSessionPendingRef.current = false;
    }
  }

  const chatWindowAnim = useDelayedUnmount(lightChatPanelOpen, WINDOW_CLOSE_MS);
  const lightChatWindow = chatWindowAnim.rendered ? (
    <LightChatWindow
      chatWindowRef={chatWindowRef}
      chatWindowPosition={chatWindowPosition}
      assistantWidth={assistantWidth}
      beginFloatingDrag={beginFloatingDrag}
      assistantDisplayName={assistantDisplayName}
      activeSession={activeSession}
      selectedTopic={selectedTopic}
      activeGraph={activeGraph}
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
      selectedTopicId={selectedTopicId}
      createTopicSession={createTopicSession}
      chatViewportRef={chatViewportRef}
      currentChatState={currentChatState}
      chatThreadLoading={chatThreadLoading}
      visibleMessages={visibleMessages}
      chatLoading={chatLoading}
      hasInlinePlanningWidget={hasInlinePlanningWidget}
      applyLoadingMessageId={applyLoadingMessageId}
      applyProposalFromMessage={applyProposalFromMessage}
      updateCurrentChatState={updateCurrentChatState}
      chatComposerRef={chatComposerRef}
      chatError={chatError}
      chatSessionsError={chatSessionsError}
      applyError={applyError}
      composerUseGrounding={composerUseGrounding}
      setComposerUseGrounding={setComposerUseGrounding}
      assistantTemplates={assistantTemplates}
      chatModelOptions={chatModelOptions}
      selectedChatModel={selectedChatModel}
      setSelectedChatModel={setSelectedChatModel}
      sendChat={sendChat}
      closing={chatWindowAnim.closing}
    />
  ) : null;

  return (
    <>
      {!experimentalLightDesktop ? (
      <aside className={`leftSidebar ${sidebarVisible ? "leftSidebarVisible" : "leftSidebarCollapsed"} ${leftSidebarClosing ? "leftSidebarClosing" : ""}`}>
        <div className="sidebarHeader">
          <div className="sidebarBrand" aria-label={`${APP_NAME} brand`}>
            <span className="sidebarBrandMark" aria-hidden="true" />
          </div>
          <button className="sidebarToggleBtn" onClick={closeSidebar} title={copy.sidebar.closeSidebar}>
            <CaretLeft size={16} weight="bold" />
          </button>
        </div>

        <div className="sidebarScrollArea">
          <div className="sidebarTree" style={{ marginTop: "20px" }}>
            <div
              className="sidebarSectionHeader sidebarSectionHeaderActive"
              onClick={() => setProjectsExpanded(!projectsExpanded)}
            >
              {copy.shell.workspace} <CaretDown size={14} weight="bold" className="sidebarCaret" style={{ transform: projectsExpanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }} />
            </div>
            {projectsExpanded && (
              <div className="sidebarTree sidebarTreeNested">
                {availableGraphs.map((graph) => (
                  <div
                    key={graph.graph_id}
                    className={`${graph.graph_id === activeGraph?.graph_id ? "sidebarGraphRow sidebarGraphRowActive" : "sidebarGraphRow"} ${renamingGraphId === graph.graph_id ? "sidebarGraphRowEditing" : ""}`}
                  >
                    {renamingGraphId === graph.graph_id ? (
                      <div className="sidebarTreeItem sidebarTreeItemInlineEdit">
                        <input
                          className="sidebarGraphTitleInput"
                          value={renameGraphDraft}
                          onChange={(event) => setRenameGraphDraft(event.target.value)}
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
                      </div>
                    ) : (
                      <button
                        className="sidebarTreeItem"
                        onClick={() => {
                          setActiveGraphId(graph.graph_id);
                          setSelectedTopicId(null);
                          setSelectedTopicAnchor(null);
                        }}
                        type="button"
                      >
                        <span>{graph.title}</span>
                      </button>
                    )}
                    <div className="sidebarGraphActions">
                      <button
                        className="sidebarExportBtn"
                        type="button"
                        title={copy.sidebar.exportGraph(graph.title)}
                        onClick={() => openExportGraphModal(graph)}
                      >
                        <DownloadSimple size={13} weight="bold" />
                      </button>
                      <button
                        className={`sidebarRenameBtn ${renamingGraphId === graph.graph_id ? "sidebarRenameBtnActive" : ""}`}
                        type="button"
                        title={renamingGraphId === graph.graph_id ? copy.sidebar.saveGraphTitle : copy.sidebar.renameGraph(graph.title)}
                        disabled={renameGraphSaving && renamingGraphId === graph.graph_id}
                        onClick={() => {
                          if (renamingGraphId === graph.graph_id) {
                            void renameGraph(graph.graph_id);
                            return;
                          }
                          setError(null);
                          setRenamingGraphId(graph.graph_id);
                          setRenameGraphDraft(graph.title);
                        }}
                      >
                        {renamingGraphId === graph.graph_id ? copy.settingsPanel.save : <PencilSimple size={12} weight="bold" />}
                      </button>
                      <button
                        className="sidebarDeleteBtn"
                        type="button"
                        title={copy.sidebar.deleteGraph(graph.title)}
                        onClick={() => setDeleteConfirm({ graphId: graph.graph_id, title: graph.title })}
                      >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M5 2V1h6v1h3v1H2V2h3zm1 3v7h1V5H6zm3 0v7h1V5H9zM3 4h10l-.8 10H3.8L3 4z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="sidebarGraphRow">
                  <button
                    className="sidebarTreeItem"
                    style={{ opacity: 0.85 }}
                    onClick={() => {
                      setCreateGraphOpen(true);
                      setCreateGraphError(null);
                    }}
                    type="button"
                  >
                    <span>+ {copy.emptyState.createGraph}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sidebarAccountSection">
          <button
            className="sidebarAccountTrigger"
            onClick={openConfigurationSettings}
            type="button"
          >
            <GearSix size={16} weight="bold" className="sidebarIcon" />
            <div className="sidebarAccountMeta">
              <span className="sidebarAccountTriggerName">{copy.shell.configuration}</span>
            </div>
          </button>
          <a
            className="sidebarAccountTrigger sidebarAccountLink"
            href="https://clew.my/how-to-use"
            target="_blank"
            rel="noreferrer"
          >
            <BookBookmark size={16} weight="bold" className="sidebarIcon" />
            <div className="sidebarAccountMeta">
              <span className="sidebarAccountTriggerName">{copy.sidebar.documentation}</span>
            </div>
          </a>
          {debugModeEnabled ? (
            <button
              className="sidebarAccountTrigger"
              onClick={openDebugLogs}
              type="button"
            >
              <BugBeetle size={16} weight="bold" className="sidebarIcon" />
              <div className="sidebarAccountMeta">
                <span className="sidebarAccountTriggerName">{copy.sidebar.logs}</span>
              </div>
            </button>
          ) : null}
        </div>
      </aside>
      ) : null}

      <main className="main">
        {!experimentalLightDesktop && !isMobileViewport && !leftSidebarOpen && !leftSidebarClosing && (
          <button className="sidebarToggleBtn floatingToggle" onClick={openSidebar} title={copy.sidebar.openSidebar}>
            <CaretRight size={16} weight="bold" />
          </button>
        )}
        {!experimentalLightDesktop && !isMobileViewport && !assistantOpen && (
          <button
            className="sidebarToggleBtn floatingToggle floatingToggleRight"
            onClick={() => setAssistantWidth(ASSISTANT_MIN_WIDTH)}
            title={copy.sidebar.openChat}
            type="button"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
        )}

        {isMobileViewport && !isSettingsOpen ? (
          <div className="mobileGraphStrip">
            <button
              className="mobileGraphCreate"
              type="button"
              onClick={() => {
                setCreateGraphOpen(true);
                setCreateGraphError(null);
              }}
            >
              {copy.graphStats.newGraph}
            </button>
            <div className="mobileGraphScroller">
              {availableGraphs.map((graph) => (
                <button
                  key={graph.graph_id}
                  className={`mobileGraphChip ${graph.graph_id === activeGraph?.graph_id ? "mobileGraphChipActive" : ""}`}
                  type="button"
                  onClick={() => {
                    setActiveGraphId(graph.graph_id);
                    setSelectedTopicId(null);
                    setSelectedTopicAnchor(null);
                  }}
                >
                  {graph.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <TopStatsOverlay
          visible={showMobileOverlay}
          wrapperClassName="topOverlayStack topOverlayStackMobile"
          wrapperStyle={{
            left: "12px",
            right: "12px",
            top: "calc(75px + env(safe-area-inset-top, 0px))",
          }}
          floatingStatsRef={floatingStatsRef}
          activeGraph={activeGraph}
          graphSummary={graphSummary}
          copy={copy}
          activeAssessmentCards={activeAssessmentCards}
          data={data}
          assessmentError={assessmentError}
          configSaving={configSaving}
          error={error}
          graphLayoutEditing={graphLayoutEditing}
          graphLayoutSaving={graphLayoutSaving}
          topOverlayCompact={topOverlayCompact}
          isMobileViewport={isMobileViewport}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          viewportCenteredZoom={viewportCenteredZoom}
          setViewportCenteredZoom={setViewportCenteredZoom}
          saveGraphLayout={saveGraphLayout}
          startGraphLayoutEdit={startGraphLayoutEdit}
          setGraphLayoutEditing={setGraphLayoutEditing}
          setGraphLayoutDraft={setGraphLayoutDraft}
          graphViewMode={graphViewMode}
          setGraphViewMode={setGraphViewMode}
        />

        <TopStatsOverlay
          visible={showCompactDesktopOverlay}
          wrapperClassName="topOverlayStack"
          wrapperStyle={{
            left: `${overlayLeftInset}px`,
            right: `${overlayRightInset}px`,
            top: "20px",
          }}
          floatingStatsRef={floatingStatsRef}
          activeGraph={activeGraph}
          graphSummary={graphSummary}
          copy={copy}
          activeAssessmentCards={activeAssessmentCards}
          data={data}
          assessmentError={assessmentError}
          configSaving={configSaving}
          error={error}
          graphLayoutEditing={graphLayoutEditing}
          graphLayoutSaving={graphLayoutSaving}
          topOverlayCompact={topOverlayCompact}
          isMobileViewport={isMobileViewport}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          viewportCenteredZoom={viewportCenteredZoom}
          setViewportCenteredZoom={setViewportCenteredZoom}
          saveGraphLayout={saveGraphLayout}
          startGraphLayoutEdit={startGraphLayoutEdit}
          setGraphLayoutEditing={setGraphLayoutEditing}
          setGraphLayoutDraft={setGraphLayoutDraft}
          graphViewMode={graphViewMode}
          setGraphViewMode={setGraphViewMode}
        />

        <TopStatsOverlay
          visible={showInlineDesktopOverlay}
          wrapperClassName="topOverlayInline"
          wrapperStyle={{
            left: `${overlayLeftInset}px`,
            right: `${overlayRightInset}px`,
            top: "20px",
          }}
          floatingStatsRef={floatingStatsRef}
          activeGraph={activeGraph}
          graphSummary={graphSummary}
          copy={copy}
          activeAssessmentCards={activeAssessmentCards}
          data={data}
          assessmentError={assessmentError}
          configSaving={configSaving}
          error={error}
          graphLayoutEditing={graphLayoutEditing}
          graphLayoutSaving={graphLayoutSaving}
          topOverlayCompact={topOverlayCompact}
          isMobileViewport={isMobileViewport}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          viewportCenteredZoom={viewportCenteredZoom}
          setViewportCenteredZoom={setViewportCenteredZoom}
          saveGraphLayout={saveGraphLayout}
          startGraphLayoutEdit={startGraphLayoutEdit}
          setGraphLayoutEditing={setGraphLayoutEditing}
          setGraphLayoutDraft={setGraphLayoutDraft}
          graphViewMode={graphViewMode}
          setGraphViewMode={setGraphViewMode}
        />

        <div ref={shellSurfaceRef} className={`workspaceShell ${experimentalLightDesktop ? "workspaceShellLightDockMode" : ""}`}>
          <div className="workspaceMain">
            <div className="neuroLayout">
              <div ref={graphShellRef} className="neuroGraphShell">
                {isMobileViewport && activeGraph ? (
                  <button
                    className="mobileRecenterBtn"
                    onClick={() => {
                      const rootId = Array.from(focusData.rootIds)[0] || activeGraph.topics[0]?.id || null;
                      handleSelectTopic(rootId, null);
                    }}
                    title={copy.graphStats.centerGraph}
                  >
                    <CrosshairSimple size={18} weight="bold" />
                  </button>
                ) : null}
                {activeGraph && graphViewMode === "3d" ? (
                  <React.Suspense fallback={<div className="graph3dLoading">Preparing 3D space…</div>}>
                    <Graph3DCanvas
                      key={`graph-3d:${activeGraph.graph_id}`}
                      topics={activeGraph.topics}
                      edges={activeGraph.edges}
                      zones={activeGraph.zones}
                      selectedTopicId={selectedTopicId}
                      rootIds={focusData.rootIds}
                      pathNodeIds={focusData.pathNodeIds}
                      pathEdgeIds={focusData.pathEdgeIds}
                      frontierEdgeIds={focusData.frontierEdgeIds}
                      onSelectTopic={handleSelectTopic}
                      onSelectedTopicAnchorChange={handleSelectedTopicAnchorChange}
                      themeMode={themeMode}
                    />
                  </React.Suspense>
                ) : activeGraph ? (
                  <GraphCanvas
                    key={`graph:${activeGraph.graph_id}`}
                    topics={activeGraph.topics}
                    edges={activeGraph.edges}
                    zones={activeGraph.zones}
                    selectedTopicId={selectedTopicId}
                    rootIds={focusData.rootIds}
                    ancestorIds={focusData.ancestorIds}
                    pathNodeIds={focusData.pathNodeIds}
                    pathEdgeIds={focusData.pathEdgeIds}
                    frontierEdgeIds={focusData.frontierEdgeIds}
                    onSelectTopic={handleSelectTopic}
                    onSelectedTopicAnchorChange={handleSelectedTopicAnchorChange}
                    graphCacheKey={`graph:${activeGraph.graph_id}`}
                    initialZoom={0.45}
                    nodePositions={graphLayoutEditing ? graphLayoutDraft : activeGraphManualLayout}
                    layoutEditMode={graphLayoutEditing}
                    onNodePositionsChange={setGraphLayoutDraft}
                    disableIdleAnimations={liveDisableIdleAnimations}
                    viewportCenteredWheelZoom={viewportCenteredZoom}
                    curvedEdgeLinesEnabled={!straightEdgeLinesEnabled}
                    themeMode={themeMode}
                    backgroundFill={graphCanvasBackgroundFill}
                  />
                ) : showGraphLoadingState || showGraphEmptyState ? (
                  <div className="emptyStateShell">
                    <div className="emptyStateCanvas" aria-hidden="true">
                      <GraphCanvas
                        key={showGraphLoadingState ? "graph:loading" : "graph:empty"}
                        topics={[]}
                        edges={[]}
                        zones={[]}
                        selectedTopicId={null}
                        rootIds={new Set()}
                        ancestorIds={new Set()}
                        pathNodeIds={new Set()}
                        pathEdgeIds={new Set()}
                        onSelectTopic={noop}
                        onSelectedTopicAnchorChange={noop}
                        initialZoom={2.2}
                        targetZoom={2.2}
                        centerOnNodeId={null}
                        graphCacheKey={showGraphLoadingState ? "graph:loading" : "graph:empty"}
                        disableIdleAnimations={showGraphLoadingState}
                        viewportCenteredWheelZoom={viewportCenteredZoom}
                        curvedEdgeLinesEnabled={!straightEdgeLinesEnabled}
                        themeMode={themeMode}
                        backgroundFill={graphCanvasBackgroundFill}
                      />
                    </div>
                    {showGraphEmptyState ? (
                      <div className="emptyStateContent">
                        <h2>{onboardingNeedsFirstGraph ? copy.emptyState.onboardingTitle : copy.emptyState.emptyTitle}</h2>
                        <p>
                          {onboardingNeedsFirstGraph
                            ? copy.emptyState.onboardingBody
                            : copy.emptyState.emptyBody}
                        </p>
                        <div className="emptyStateActions">
                          <button
                            className="emptyStateAction"
                            disabled={workspaceSurface ? !workspaceSurface.can_create_graph : false}
                            onClick={() => {
                              setCreateGraphOpen(true);
                              setCreateGraphError(null);
                            }}
                            type="button"
                          >
                            {copy.emptyState.createGraph}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {topicPopoverConnector ? (
                  <svg className="topicPopoverConnector" aria-hidden="true">
                    <path className="topicPopoverConnectorLine" d={topicPopoverConnector.path} />
                  </svg>
                ) : null}

                {selectedTopic && popoverPosition ? (
                  <div
                    ref={topicPopoverRef}
                    className={`topicPopover topicPopover-${popoverPosition.side}`}
                    style={{ left: `${popoverPosition.left}px`, top: `${popoverPosition.top}px` }}
                    onPointerDown={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("button, a, input, textarea, select")) {
                        return;
                      }
                      if (!popoverPosition) return;
                      popoverDragRef.current = {
                        pointerX: event.clientX,
                        pointerY: event.clientY,
                        startX: popoverPosition.left,
                        startY: popoverPosition.top,
                      };
                    }}
                  >
                    <div className="topicPopoverHeader">
                      <div className="topicPopoverEyebrow">{copy.topic.eyebrow}</div>
                      <button
                        className="topicPopoverClose"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          setSelectedTopicId(null);
                          setSelectedTopicAnchor(null);
                        }}
                        type="button"
                        aria-label={copy.topic.closeTopic}
                      >
                        ×
                      </button>
                    </div>
                    <div className="topicPopoverTitle">{selectedTopic.title}</div>
                    <div className="topicPopoverMeta">
                      <span className="badge badge-blue">{formatTopicState(selectedTopic.state)}</span>
                      <span className="badge badge-gray">{formatMinutes(selectedTopic.estimated_minutes, copy)}</span>
                      {selectedZoneLabel ? <span className="badge badge-gray">{selectedZoneLabel}</span> : null}
                    </div>
                    <div className="topicPopoverSection">
                      <div className="topicPopoverLabel">{copy.topic.description}</div>
                      <div className="topicPopoverCopy">{renderDisplayText(selectedTopic.description || copy.topic.noDescription)}</div>
                    </div>
                    <div className="topicPopoverSection">
                      <div className="topicPopoverLabel">{copy.topic.foundationPath}</div>
                      <div className="topicPopoverCopy topicPopoverPath">
                        {pathTitles.length > 0 ? pathTitles.join(" → ") : selectedTopic.title}
                      </div>
                    </div>
                    <div className="topicPopoverSection">
                      <div className="topicPopoverSectionHeader">
                        <div className="topicPopoverLabel">{copy.topic.resources}</div>
                        <button
                          className="topicPopoverInlineAddButton"
                          type="button"
                          aria-label={copy.topic.addResource}
                          title={copy.topic.addResource}
                          onClick={() => openTopicAssetDialog("resource")}
                        >
                          +
                        </button>
                      </div>
                      {selectedResourceLinks.length > 0 ? (
                        <div className="topicPopoverList">
                          {selectedResourceLinks
                            .map((resource) => ({ resource, safeUrl: safeExternalUrl(resource.url) }))
                            .filter((item): item is { resource: typeof selectedResourceLinks[number]; safeUrl: string } => Boolean(item.safeUrl))
                            .map(({ resource, safeUrl }) => (
                              <a key={resource.id} className="topicPopoverLink" href={safeUrl} rel="noopener noreferrer nofollow" target="_blank">
                                <span>{resource.label}</span>
                                <span className="topicPopoverLinkKind">{resource.kind}</span>
                              </a>
                            ))}
                        </div>
                      ) : (
                        <div className="mutedSmall">{copy.topic.noResources}</div>
                      )}
                    </div>
                    <div className="topicPopoverSection">
                      <div className="topicPopoverSectionHeader">
                        <div className="topicPopoverLabel">{copy.topic.artifacts}</div>
                        <button
                          className="topicPopoverInlineAddButton"
                          type="button"
                          aria-label={copy.topic.addArtifact}
                          title={copy.topic.addArtifact}
                          onClick={() => openTopicAssetDialog("artifact")}
                        >
                          +
                        </button>
                      </div>
                      {selectedArtifacts.length > 0 ? (
                        <div className="topicPopoverList">
                          {selectedArtifacts.map((artifact) => (
                            <div key={artifact.id} className="topicPopoverArtifact">
                              <div className="topicPopoverArtifactTitle">
                                <span>{artifact.title}</span>
                                <span className="topicPopoverArtifactKind">{artifact.kind}</span>
                              </div>
                              <div className="topicPopoverArtifactBody">{renderDisplayText(artifact.body || copy.topic.noArtifactBody)}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mutedSmall">{copy.topic.noArtifacts}</div>
                      )}
                    </div>
                    {selectedClosureStatus ? (
                      <div className="topicPopoverSection">
                        <div className="topicPopoverLabel">{copy.topic.closure}</div>
                        {selectedClosureStatus.latest_attempt ? (
                          <div className="row" style={{ gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                            <span className="badge badge-gray">{copy.closure.latestQuiz(selectedClosureStatus.latest_attempt.score * 100)}</span>
                            <span className={`badge ${selectedClosureStatus.latest_attempt.passed ? "badge-green" : "badge-red"}`}>
                              {selectedClosureStatus.latest_attempt.passed ? copy.closure.passed : copy.closure.failed}
                            </span>
                            {!selectedClosureStatus.latest_attempt.passed && selectedClosureStatus.latest_attempt.fail_count > 0 ? (
                              <span className="badge badge-yellow">{copy.closure.failedCount(selectedClosureStatus.latest_attempt.fail_count)}</span>
                            ) : null}
                          </div>
                        ) : null}
                        {!closureTestsEnabled ? null : selectedClosureStatus.blocked_prerequisite_ids.length === 0 ? (
                          <div className="mutedSmall">{copy.topic.allClosed}</div>
                        ) : (
                          <div className="mutedSmall">{copy.topic.blockedCount(selectedClosureStatus.blocked_prerequisite_ids.length)}</div>
                        )}
                        {closureTestsEnabled && selectedClosureStatus.blocked_prerequisite_ids.length > 0 ? (
                          <div className="topicPopoverCopy">
                            {copy.closure.blockedBy}{" "}
                            {selectedClosureStatus.blocked_prerequisite_ids
                              .map((topicId) => topicTitlesById.get(topicId) ?? topicId)
                              .join(" · ")}
                          </div>
                        ) : null}
                        <div className="row topicClosureActions" style={{ justifyContent: "flex-end", gap: "8px" }}>
                          {quizError ? <span className="badge badge-red">{quizError}</span> : null}
                          {quizSuccess ? (
                            <span className={`badge ${quizSuccess === copy.closure.markAsFinished ? "badge-yellow" : "badge-green"}`}>
                              {quizSuccess}
                            </span>
                          ) : null}
                          {closureTestsEnabled && !selectedClosureStatus.can_award_completion ? (
                            <div className="topicClosureBlockedHint">{copy.closure.closePrerequisitesFirst}</div>
                          ) : null}
                          {!(selectedTopicClosed && !closureTestsEnabled) ? (
                            <button
                              className={`assistantSendButton ${closureTestsEnabled ? "startQuizButton" : "markFinishedButton"}`}
                              disabled={quizLoading || (closureTestsEnabled && !selectedClosureStatus.can_award_completion)}
                              onClick={() => void (closureTestsEnabled ? startQuiz() : markTopicFinished())}
                              type="button"
                            >
                              {quizLoading
                                ? (closureTestsEnabled ? copy.closure.generatingQuiz : copy.closure.markingAsFinished)
                                : (closureTestsEnabled ? copy.closure.startClosureQuiz : copy.closure.markAsFinished)}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {!experimentalLightDesktop ? (
          <aside
            className={`assistantDock ${assistantOpen ? "assistantDockOpen" : "assistantDockHidden"}`}
            style={{
              width: assistantOpen ? `${assistantWidth}px` : "0px",
              userSelect: assistantResizing ? "none" : "auto",
            }}
          >
            <div
              className="assistantDockResize"
              onMouseDown={(event) => {
                event.preventDefault();
                handleAssistantResize(event.clientX);
              }}
            />
            <div className="assistantDockHeader">
              <div>
                <div className="assistantDockTitleRow">
                  <div className="assistantDockTitle">
                    {assistantDisplayName}
                  </div>
                  <AssistantModelMenuTrigger
                    options={chatModelOptions}
                    selectedModel={selectedChatModel}
                    setSelectedModel={setSelectedChatModel}
                    ariaLabel={copy.sessions.modelPicker}
                  />
                </div>
                <div className="assistantDockSubtle">
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
          </aside>
          ) : null}

          {experimentalLightDesktop ? (
            <>
              <div
                ref={dockRef}
                className="lightDock lightFloatingWindowEnter"
                style={{ left: `${dockPosition.x}px`, top: `${dockPosition.y}px` }}
              >
                <div className="lightDockGrip" onPointerDown={(event) => beginFloatingDrag("dock", event)} />
                <button
                  className={`lightDockButton ${lightWorkspacePanelOpen ? "lightDockButtonActive" : ""}`}
                  onClick={toggleExperimentalWorkspaceWindow}
                  title={copy.shell.workspace}
                  type="button"
                >
                  <SquaresFour size={28} weight={getDockIconWeight(lightWorkspacePanelOpen)} />
                </button>
                <button
                  className={`lightDockButton ${lightChatPanelOpen ? "lightDockButtonActive" : ""}`}
                  onClick={toggleExperimentalChatWindow}
                  title={copy.shell.chat}
                  type="button"
                >
                  <ChatCircleDots size={28} weight={getDockIconWeight(lightChatPanelOpen)} />
                </button>
                <button className={`lightDockButton ${isSettingsOpen ? "lightDockButtonActive" : ""}`} onClick={openConfigurationSettings} title={copy.shell.configuration} type="button">
                  <GearSix size={28} weight={getDockIconWeight(isSettingsOpen)} />
                </button>
                <a className="lightDockButton lightDockButtonLink" href="https://clew.my/how-to-use" rel="noreferrer" target="_blank" title={copy.sidebar.documentation}>
                  <BookBookmark size={28} weight={getDockIconWeight(false)} />
                </a>
                {debugModeEnabled ? (
                  <button className={`lightDockButton ${isLogsOpen ? "lightDockButtonActive" : ""}`} onClick={openDebugLogs} title={copy.sidebar.logs} type="button">
                    <BugBeetle size={28} weight={getDockIconWeight(isLogsOpen)} />
                  </button>
                ) : null}
              </div>
              {lightWorkspaceWindow}
              {lightChatWindow}
            </>
          ) : null}
        </div>

        {isMobileViewport ? (
          (() => {
            const workspaceActive = !assistantOpen && !mobileMenuOpen && !isSettingsOpen;
            return (
          <div className="lightDock lightDockHorizontal">
            <button
              className={`lightDockButton ${workspaceActive ? "lightDockButtonActive" : ""}`}
              type="button"
              aria-label={copy.shell.workspace}
              title={copy.shell.workspace}
              onClick={() => {
                if (modalSurfaceLocked) {
                  closeOverlaySurfaces();
                }
                setMobileMenuOpen(false);
                setAssistantWidth(0);
              }}
            >
              <SquaresFour size={28} weight={getDockIconWeight(workspaceActive)} />
            </button>
            {activeGraph ? (
              <button
                className={`lightDockButton ${assistantOpen ? "lightDockButtonActive" : ""}`}
                type="button"
                aria-label={copy.shell.chat}
                title={copy.shell.chat}
                onClick={() => {
                  if (modalSurfaceLocked) {
                    closeOverlaySurfaces();
                  }
                  setMobileMenuOpen(false);
                  setAssistantWidth((current) => {
                    const opening = current < ASSISTANT_MIN_WIDTH;
                    if (opening) {
                      return 360;
                    }
                    return 0;
                  });
                }}
              >
                <ChatCircleDots size={28} weight={getDockIconWeight(assistantOpen)} />
              </button>
            ) : null}
            <button
              className={`lightDockButton ${isSettingsOpen ? "lightDockButtonActive" : ""}`}
              type="button"
              aria-label={copy.shell.configuration}
              title={copy.shell.configuration}
              onClick={openConfigurationSettings}
            >
              <GearSix size={28} weight={getDockIconWeight(isSettingsOpen)} />
            </button>
          </div>
            );
          })()
        ) : null}
      </main>
      {topicAssetDialog ? (
        <TopicAssetModal
          topicAssetDialog={topicAssetDialog}
          themeMode={themeMode}
          topicAssetModalRef={topicAssetModalRef}
          closeTopicAssetModal={closeTopicAssetModal}
          copy={copy}
          topicAssetPrimaryInputRef={topicAssetPrimaryInputRef}
          topicResourceUrlDraft={topicResourceUrlDraft}
          setTopicResourceUrlDraft={setTopicResourceUrlDraft}
          topicArtifactTitleDraft={topicArtifactTitleDraft}
          setTopicArtifactTitleDraft={setTopicArtifactTitleDraft}
          topicArtifactBodyDraft={topicArtifactBodyDraft}
          setTopicArtifactBodyDraft={setTopicArtifactBodyDraft}
          topicAssetError={topicAssetError}
          topicAssetSaving={topicAssetSaving}
          submitTopicAssetDialog={submitTopicAssetDialog}
        />
      ) : null}
    </>
  );
}
