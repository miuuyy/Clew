import React from "react";

import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { CreateGraphDialog } from "./dialogs/CreateGraphDialog";
import { ExportGraphDialog } from "./dialogs/ExportGraphDialog";
import { ImportGraphDialog } from "./dialogs/ImportGraphDialog";
import { ObsidianImportDialog } from "./dialogs/ObsidianImportDialog";
import { QuizDialog } from "./dialogs/QuizDialog";
import { API_BASE } from "../lib/api";
import type { AppCopy } from "../lib/appCopy";
import { type apiFetch, type readErrorMessage } from "../lib/apiRequest";
import type { ObsidianImportOptions, ObsidianImportPreview } from "../lib/obsidianImport";
import type {
  CreateGraphRequest,
  GraphEnvelope,
  GraphExportFormat,
  GraphExportPackagePayload,
  ObsidianExportOptions,
  QuizQuestionReview,
  Topic,
  TopicQuizSession,
  WorkspaceEnvelope,
} from "../lib/types";

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;

type AppDialogsProps = {
  copy: AppCopy;
  deleteConfirm: { graphId: string; title: string } | null;
  deleteGraphModalRef: React.RefObject<HTMLDivElement | null>;
  closeDeleteGraphModal: () => void;
  deleteGraphCancelButtonRef: React.RefObject<HTMLButtonElement | null>;
  apiFetch: typeof apiFetch;
  readErrorMessage: typeof readErrorMessage;
  setDeleteConfirm: StateSetter<{ graphId: string; title: string } | null>;
  setData: StateSetter<WorkspaceEnvelope | null>;
  setActiveGraphId: StateSetter<string | null>;
  clearChatStateForGraph: (graphId: string | null | undefined) => void;
  loadSnapshots: () => Promise<void>;
  loadSessionInfo: () => Promise<unknown>;
  setError: StateSetter<string | null>;
  sessionDeleteConfirm: { sessionId: string; title: string } | null;
  sessionDeleteModalRef: React.RefObject<HTMLDivElement | null>;
  closeSessionDeleteModal: () => void;
  sessionDeleteCancelButtonRef: React.RefObject<HTMLButtonElement | null>;
  setSessionDeleteConfirm: StateSetter<{ sessionId: string; title: string } | null>;
  activeGraph: GraphEnvelope | null;
  activeSessionId: string | null;
  setActiveSessionId: StateSetter<string | null>;
  loadSessions: () => Promise<void>;
  createGraphOpen: boolean;
  createGraphModalRef: React.RefObject<HTMLDivElement | null>;
  closeCreateGraphModal: () => void;
  createGraphTitleInputRef: React.RefObject<HTMLInputElement | null>;
  createGraphDraft: CreateGraphRequest;
  setCreateGraphDraft: StateSetter<CreateGraphRequest>;
  createGraphError: string | null;
  openImportGraphModal: () => void;
  openImportObsidianModal: () => void;
  createGraphLoading: boolean;
  createGraph: () => Promise<void>;
  importGraphOpen: boolean;
  importGraphModalRef: React.RefObject<HTMLDivElement | null>;
  closeImportGraphModal: () => void;
  importGraphFileInputRef: React.RefObject<HTMLInputElement | null>;
  importGraphFileButtonRef: React.RefObject<HTMLButtonElement | null>;
  handleImportGraphFile: (file: File) => Promise<void>;
  importGraphFileName: string | null;
  importGraphPayload: GraphExportPackagePayload | null;
  importGraphTitleDraft: string;
  setImportGraphTitleDraft: StateSetter<string>;
  importGraphIncludeProgressDraft: boolean;
  setImportGraphIncludeProgressDraft: StateSetter<boolean>;
  importGraphError: string | null;
  importGraphLoading: boolean;
  importGraphFromPackage: () => Promise<void>;
  importObsidianOpen: boolean;
  importObsidianModalRef: React.RefObject<HTMLDivElement | null>;
  closeImportObsidianModal: () => void;
  importObsidianFolderInputRef: React.RefObject<HTMLInputElement | null>;
  importObsidianFolderButtonRef: React.RefObject<HTMLButtonElement | null>;
  handleObsidianVaultFiles: (files: FileList | null) => Promise<void>;
  obsidianVaultName: string | null;
  obsidianImportDraft: Omit<ObsidianImportOptions, "vaultName">;
  setObsidianImportDraft: StateSetter<Omit<ObsidianImportOptions, "vaultName">>;
  obsidianImportPreview: ObsidianImportPreview | null;
  importObsidianError: string | null;
  importObsidianLoading: boolean;
  importGraphFromObsidian: () => Promise<void>;
  exportGraphTarget: GraphEnvelope | null;
  exportGraphModalRef: React.RefObject<HTMLDivElement | null>;
  closeExportGraphModal: () => void;
  exportGraphTitleInputRef: React.RefObject<HTMLInputElement | null>;
  exportGraphTitleDraft: string;
  setExportGraphTitleDraft: StateSetter<string>;
  exportGraphIncludeProgressDraft: boolean;
  setExportGraphIncludeProgressDraft: StateSetter<boolean>;
  exportGraphFormatDraft: GraphExportFormat;
  setExportGraphFormatDraft: StateSetter<GraphExportFormat>;
  exportGraphObsidianOptionsDraft: ObsidianExportOptions;
  setExportGraphObsidianOptionsDraft: StateSetter<ObsidianExportOptions>;
  exportGraphError: string | null;
  exportGraphLoading: boolean;
  exportGraph: (graph: GraphEnvelope) => Promise<void>;
  quizSession: TopicQuizSession | null;
  quizModalRef: React.RefObject<HTMLDivElement | null>;
  quizCloseButtonRef: React.RefObject<HTMLButtonElement | null>;
  selectedTopic: Topic | null;
  closeQuizModal: () => void;
  quizError: string | null;
  quizReviews: QuizQuestionReview[] | null;
  quizAnswers: Record<string, number>;
  setQuizAnswers: StateSetter<Record<string, number>>;
  quizLoading: boolean;
  submitQuiz: () => Promise<void>;
};

export function AppDialogs(props: AppDialogsProps): React.JSX.Element {
  const {
    copy,
    deleteConfirm,
    deleteGraphModalRef,
    closeDeleteGraphModal,
    deleteGraphCancelButtonRef,
    apiFetch,
    readErrorMessage,
    setDeleteConfirm,
    setData,
    setActiveGraphId,
    clearChatStateForGraph,
    loadSnapshots,
    loadSessionInfo,
    setError,
    sessionDeleteConfirm,
    sessionDeleteModalRef,
    closeSessionDeleteModal,
    sessionDeleteCancelButtonRef,
    setSessionDeleteConfirm,
    activeGraph,
    activeSessionId,
    setActiveSessionId,
    loadSessions,
    createGraphOpen,
    createGraphModalRef,
    closeCreateGraphModal,
    createGraphTitleInputRef,
    createGraphDraft,
    setCreateGraphDraft,
    createGraphError,
    openImportGraphModal,
    openImportObsidianModal,
    createGraphLoading,
    createGraph,
    importGraphOpen,
    importGraphModalRef,
    closeImportGraphModal,
    importGraphFileInputRef,
    importGraphFileButtonRef,
    handleImportGraphFile,
    importGraphFileName,
    importGraphPayload,
    importGraphTitleDraft,
    setImportGraphTitleDraft,
    importGraphIncludeProgressDraft,
    setImportGraphIncludeProgressDraft,
    importGraphError,
    importGraphLoading,
    importGraphFromPackage,
    importObsidianOpen,
    importObsidianModalRef,
    closeImportObsidianModal,
    importObsidianFolderInputRef,
    importObsidianFolderButtonRef,
    handleObsidianVaultFiles,
    obsidianVaultName,
    obsidianImportDraft,
    setObsidianImportDraft,
    obsidianImportPreview,
    importObsidianError,
    importObsidianLoading,
    importGraphFromObsidian,
    exportGraphTarget,
    exportGraphModalRef,
    closeExportGraphModal,
    exportGraphTitleInputRef,
    exportGraphTitleDraft,
    setExportGraphTitleDraft,
    exportGraphIncludeProgressDraft,
    setExportGraphIncludeProgressDraft,
    exportGraphFormatDraft,
    setExportGraphFormatDraft,
    exportGraphObsidianOptionsDraft,
    setExportGraphObsidianOptionsDraft,
    exportGraphError,
    exportGraphLoading,
    exportGraph,
    quizSession,
    quizModalRef,
    quizCloseButtonRef,
    selectedTopic,
    closeQuizModal,
    quizError,
    quizReviews,
    quizAnswers,
    setQuizAnswers,
    quizLoading,
    submitQuiz,
  } = props;

  const obsidianIssues = obsidianImportPreview?.issues ?? [];
  const obsidianErrors = obsidianIssues.filter((issue) => issue.level === "error");
  const obsidianWarnings = obsidianIssues.filter((issue) => issue.level === "warning");

  async function deleteGraphConfirmed(): Promise<void> {
    if (!deleteConfirm) return;
    const { graphId } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      const response = await apiFetch(`${API_BASE}/api/v1/workspace/graphs/${graphId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readErrorMessage(response, copy.errors.deleteGraph));
      const payload = await response.json();
      clearChatStateForGraph(graphId);
      setData(payload);
      setActiveGraphId(payload.workspace.active_graph_id ?? payload.workspace.graphs[0]?.graph_id ?? null);
      void loadSnapshots();
      void loadSessionInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.deleteGraph);
    }
  }

  async function deleteSessionConfirmed(): Promise<void> {
    if (!sessionDeleteConfirm || !activeGraph) return;
    const { sessionId } = sessionDeleteConfirm;
    setSessionDeleteConfirm(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/v1/graphs/${activeGraph.graph_id}/chat/sessions/${sessionId}`, { method: "DELETE" });
      if (!resp.ok) {
        const msg = await readErrorMessage(resp, copy.errors.deleteSession);
        setError(msg);
        return;
      }
      if (activeSessionId === sessionId) setActiveSessionId(null);
      void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.deleteSession);
    }
  }

  return (
    <>
      <ConfirmDialog
        open={Boolean(deleteConfirm)}
        modalRef={deleteGraphModalRef}
        cancelButtonRef={deleteGraphCancelButtonRef}
        id="delete-graph-dialog"
        title={copy.dialogs.deleteGraphTitle}
        body={copy.dialogs.deleteGraphBody}
        message={deleteConfirm ? copy.dialogs.deleteGraphConfirm(deleteConfirm.title) : ""}
        cancelLabel={copy.dialogs.cancel}
        confirmLabel={copy.dialogs.delete}
        onCancel={closeDeleteGraphModal}
        onConfirm={() => void deleteGraphConfirmed()}
      />

      <ConfirmDialog
        open={Boolean(sessionDeleteConfirm && activeGraph)}
        modalRef={sessionDeleteModalRef}
        cancelButtonRef={sessionDeleteCancelButtonRef}
        id="delete-session-dialog"
        title={copy.dialogs.deleteChatSessionTitle}
        body={copy.dialogs.deleteChatSessionBody}
        message={sessionDeleteConfirm ? copy.dialogs.deleteChatSessionConfirm(sessionDeleteConfirm.title) : ""}
        cancelLabel={copy.dialogs.cancel}
        confirmLabel={copy.dialogs.delete}
        onCancel={closeSessionDeleteModal}
        onConfirm={() => void deleteSessionConfirmed()}
      />

      <CreateGraphDialog
        open={createGraphOpen}
        modalRef={createGraphModalRef}
        closeModal={closeCreateGraphModal}
        titleInputRef={createGraphTitleInputRef}
        draft={createGraphDraft}
        setDraft={setCreateGraphDraft}
        error={createGraphError}
        loading={createGraphLoading}
        openImportObsidianModal={openImportObsidianModal}
        openImportGraphModal={openImportGraphModal}
        createGraph={createGraph}
        copy={copy}
      />

      <ImportGraphDialog
        open={importGraphOpen}
        modalRef={importGraphModalRef}
        closeModal={closeImportGraphModal}
        fileInputRef={importGraphFileInputRef}
        fileButtonRef={importGraphFileButtonRef}
        handleImportFile={handleImportGraphFile}
        fileName={importGraphFileName}
        payload={importGraphPayload}
        titleDraft={importGraphTitleDraft}
        setTitleDraft={setImportGraphTitleDraft}
        includeProgressDraft={importGraphIncludeProgressDraft}
        setIncludeProgressDraft={setImportGraphIncludeProgressDraft}
        error={importGraphError}
        loading={importGraphLoading}
        importGraphFromPackage={importGraphFromPackage}
        copy={copy}
      />

      <ObsidianImportDialog
        open={importObsidianOpen}
        modalRef={importObsidianModalRef}
        closeModal={closeImportObsidianModal}
        folderInputRef={importObsidianFolderInputRef}
        folderButtonRef={importObsidianFolderButtonRef}
        handleVaultFiles={handleObsidianVaultFiles}
        vaultName={obsidianVaultName}
        draft={obsidianImportDraft}
        setDraft={setObsidianImportDraft}
        preview={obsidianImportPreview}
        issues={obsidianIssues}
        warnings={obsidianWarnings}
        errors={obsidianErrors}
        loading={importObsidianLoading}
        error={importObsidianError}
        importGraphFromObsidian={importGraphFromObsidian}
        copy={copy}
      />

      <ExportGraphDialog
        target={exportGraphTarget}
        modalRef={exportGraphModalRef}
        titleInputRef={exportGraphTitleInputRef}
        closeModal={closeExportGraphModal}
        titleDraft={exportGraphTitleDraft}
        setTitleDraft={setExportGraphTitleDraft}
        includeProgressDraft={exportGraphIncludeProgressDraft}
        setIncludeProgressDraft={setExportGraphIncludeProgressDraft}
        formatDraft={exportGraphFormatDraft}
        setFormatDraft={setExportGraphFormatDraft}
        obsidianOptionsDraft={exportGraphObsidianOptionsDraft}
        setObsidianOptionsDraft={setExportGraphObsidianOptionsDraft}
        error={exportGraphError}
        loading={exportGraphLoading}
        exportGraph={exportGraph}
        copy={copy}
      />

      <QuizDialog
        session={quizSession}
        modalRef={quizModalRef}
        closeButtonRef={quizCloseButtonRef}
        selectedTopic={selectedTopic}
        closeModal={closeQuizModal}
        error={quizError}
        reviews={quizReviews}
        answers={quizAnswers}
        setAnswers={setQuizAnswers}
        loading={quizLoading}
        submitQuiz={submitQuiz}
        copy={copy}
      />
    </>
  );
}
