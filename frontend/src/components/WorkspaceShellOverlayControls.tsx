import React from "react";
import { Cube, Graph, LockSimple, LockSimpleOpen, Moon, PencilSimple, SunDim, X } from "@phosphor-icons/react";

import type { AppCopy } from "../lib/appCopy";
import type { GraphAssessment, WorkspaceEnvelope, GraphEnvelope } from "../lib/types";

type GraphSummary = {
  topicCount: number;
  completedPercent: number;
  completedCount: number;
  reviewCount: number;
};

export type GraphViewMode = "2d" | "3d";

export function GraphStatItems({
  activeGraph,
  graphSummary,
  copy,
  activeAssessmentCards,
  data,
  assessmentError,
  configSaving,
  error,
  graphLayoutEditing,
  topOverlayCompact,
  isMobileViewport,
}: {
  activeGraph: GraphEnvelope | null;
  graphSummary: GraphSummary;
  copy: AppCopy;
  activeAssessmentCards: GraphAssessment["cards"];
  data: WorkspaceEnvelope | null;
  assessmentError: string | null;
  configSaving: boolean;
  error: string | null;
  graphLayoutEditing: boolean;
  topOverlayCompact: boolean;
  isMobileViewport: boolean;
}): React.JSX.Element {
  const assessment = activeAssessmentCards.map((card) => (
    <span
      key={card.label}
      className={`statSeg ${card.tone === "good" ? "statSegGood" : card.tone === "warn" ? "statSegWarn" : ""}`}
      title={card.rationale}
    >
      <span className="statSegLabel">{card.label}</span>
      <strong>{card.value}</strong>
    </span>
  ));
  const notices = [assessmentError, error].filter((entry): entry is string => !!entry);
  return (
    <>
      <div className="statStrip">
        {activeGraph ? <span className="statSeg statSegLang">{activeGraph.language.toUpperCase()}</span> : null}
        <span className="statSeg">
          <strong>{graphSummary.topicCount}</strong>
          <span className="statSegLabel">{copy.graphStats.topics}</span>
        </span>
        <span className={`statSeg ${graphSummary.completedPercent > 0 ? "statSegGood" : ""}`}>
          <strong>{graphSummary.completedPercent}%</strong>
          <span className="statSegLabel">{copy.graphStats.complete}</span>
        </span>
        {graphSummary.reviewCount > 0 ? (
          <span className="statSeg statSegWarn">
            <strong>{graphSummary.reviewCount}</strong>
            <span className="statSegLabel">{copy.graphStats.review}</span>
          </span>
        ) : null}
        {assessment}
        {data ? <span className="statSeg statSegQuiet">{copy.graphStats.snapshot(data.snapshot.id)}</span> : null}
        {configSaving ? <span className="statSeg statSegQuiet">{copy.graphStats.saving}</span> : null}
      </div>
      {notices.map((entry) => <span key={entry} className="statNotice">{entry}</span>)}
      {graphLayoutEditing && !topOverlayCompact && !isMobileViewport ? <span className="statHint">{copy.graphStats.mayJitterWhileDragging}</span> : null}
    </>
  );
}

export function OverlayControls({
  activeGraph,
  themeMode,
  setThemeMode,
  viewportCenteredZoom,
  setViewportCenteredZoom,
  graphLayoutEditing,
  saveGraphLayout,
  startGraphLayoutEdit,
  graphLayoutSaving,
  copy,
  setGraphLayoutEditing,
  setGraphLayoutDraft,
  graphViewMode,
  setGraphViewMode,
}: {
  activeGraph: GraphEnvelope | null;
  themeMode: "light" | "dark";
  setThemeMode: React.Dispatch<React.SetStateAction<"light" | "dark">>;
  viewportCenteredZoom: boolean;
  setViewportCenteredZoom: React.Dispatch<React.SetStateAction<boolean>>;
  graphLayoutEditing: boolean;
  saveGraphLayout: () => Promise<void>;
  startGraphLayoutEdit: () => void;
  graphLayoutSaving: boolean;
  copy: AppCopy;
  setGraphLayoutEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setGraphLayoutDraft: React.Dispatch<React.SetStateAction<Record<string, { x: number; y: number }> | null>>;
  graphViewMode: GraphViewMode;
  setGraphViewMode: React.Dispatch<React.SetStateAction<GraphViewMode>>;
}): React.JSX.Element {
  if (!activeGraph) return <></>;
  return (
    <div className="controlStrip">
      {activeGraph ? (
        <button
          className={`floatingStatusButton ${themeMode === "light" ? "floatingStatusButtonActive" : ""}`}
          onClick={() => setThemeMode((current) => current === "light" ? "dark" : "light")}
          type="button"
          title={themeMode === "light" ? copy.graphStats.switchToDarkTheme : copy.graphStats.switchToLightTheme}
          aria-label={themeMode === "light" ? copy.graphStats.switchToDarkTheme : copy.graphStats.switchToLightTheme}
        >
          {themeMode === "light" ? <Moon size={15} weight="bold" /> : <SunDim size={15} weight="bold" />}
        </button>
      ) : null}
      {activeGraph ? (
        <button
          className={`floatingStatusButton ${graphViewMode === "3d" ? "floatingStatusButtonActive" : ""}`}
          onClick={() => {
            if (graphLayoutEditing) {
              setGraphLayoutEditing(false);
              setGraphLayoutDraft(null);
            }
            setGraphViewMode((current) => current === "2d" ? "3d" : "2d");
          }}
          type="button"
          title={graphViewMode === "2d" ? "Switch to 3D graph" : "Switch to 2D graph"}
          aria-label={graphViewMode === "2d" ? "Switch to 3D graph" : "Switch to 2D graph"}
          aria-pressed={graphViewMode === "3d"}
        >
          {graphViewMode === "2d" ? <Cube size={15} weight="bold" /> : <Graph size={15} weight="bold" />}
        </button>
      ) : null}
      {activeGraph && graphViewMode === "2d" ? (
        <button
          className={`floatingStatusButton ${viewportCenteredZoom ? "floatingStatusButtonActive" : ""}`}
          onClick={() => setViewportCenteredZoom((value: boolean) => !value)}
          type="button"
          title={viewportCenteredZoom ? copy.graphStats.viewportCenteredZoomEnabled : copy.graphStats.pointerFollowZoomEnabled}
          aria-label={viewportCenteredZoom ? copy.graphStats.viewportCenteredZoomEnabled : copy.graphStats.pointerFollowZoomEnabled}
          aria-pressed={viewportCenteredZoom}
        >
          {viewportCenteredZoom ? <LockSimple size={15} weight="bold" /> : <LockSimpleOpen size={15} weight="bold" />}
        </button>
      ) : null}
      {activeGraph && graphViewMode === "2d" ? (
        <button
          className={`floatingStatusButton ${graphLayoutEditing ? "floatingStatusButtonText floatingStatusButtonActive" : ""}`}
          onClick={() => {
            if (graphLayoutEditing) {
              void saveGraphLayout();
              return;
            }
            startGraphLayoutEdit();
          }}
          type="button"
          disabled={graphLayoutSaving}
          title={graphLayoutEditing ? copy.graphStats.saveLayout : copy.graphStats.editGraphLayout}
          aria-label={graphLayoutEditing ? copy.graphStats.saveLayout : copy.graphStats.editGraphLayout}
        >
          {graphLayoutEditing ? copy.graphStats.saveLayout : <PencilSimple size={15} weight="bold" />}
        </button>
      ) : null}
      {graphViewMode === "2d" && graphLayoutEditing ? (
        <button
          className="floatingStatusButton"
          aria-label={copy.graphStats.cancelLayoutEdit}
          onClick={() => {
            setGraphLayoutEditing(false);
            setGraphLayoutDraft(null);
          }}
          type="button"
          title={copy.graphStats.cancelLayoutEdit}
        >
          <X size={14} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
