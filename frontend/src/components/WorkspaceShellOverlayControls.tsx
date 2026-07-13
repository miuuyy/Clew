import React from "react";
import { Cube, Graph, LockSimple, LockSimpleOpen, Moon, PencilSimple, SunDim } from "@phosphor-icons/react";

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
  return (
    <>
      {activeGraph ? <span className="pageStat" style={{ fontWeight: 700, letterSpacing: "0.04em" }}>{activeGraph.language.toUpperCase()}</span> : null}
      <span className="pageStat">
        <strong>{graphSummary.topicCount}</strong>
        {copy.graphStats.topics}
      </span>
      <span className="pageStat pageStatComplete">
        <strong>{graphSummary.completedPercent}%</strong>
        {copy.graphStats.complete}
      </span>
      {graphSummary.reviewCount > 0 ? (
        <span className="pageStat pageStatWarn">
          <strong>{graphSummary.reviewCount}</strong>
          {copy.graphStats.review}
        </span>
      ) : null}
      {activeAssessmentCards.map((card) => (
        <span
          key={card.label}
          className={`pageStat pageStatAssessment ${card.tone === "good" ? "pageStatGood" : card.tone === "warn" ? "pageStatWarn" : ""}`}
          title={card.rationale}
        >
          <strong>{card.label}</strong>
          {card.value}
        </span>
      ))}
      {data ? <span className="badge badge-gray">{copy.graphStats.snapshot(data.snapshot.id)}</span> : null}
      {assessmentError ? <span className="badge badge-red">{assessmentError}</span> : null}
      {configSaving ? <span className="badge badge-yellow">{copy.graphStats.saving}</span> : null}
      {error ? <span className="badge badge-red">{error}</span> : null}
      {graphLayoutEditing && !topOverlayCompact && !isMobileViewport ? <span className="pageStat pageStatHint">{copy.graphStats.mayJitterWhileDragging}</span> : null}
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
  return (
    <>
      {activeGraph ? (
        <button
          className={`floatingStatusButton ${themeMode === "light" ? "floatingStatusButtonActive" : ""}`}
          onClick={() => setThemeMode((current) => current === "light" ? "dark" : "light")}
          type="button"
          title={themeMode === "light" ? copy.graphStats.switchToDarkTheme : copy.graphStats.switchToLightTheme}
          aria-pressed={themeMode === "light"}
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
          aria-pressed={viewportCenteredZoom}
        >
          {viewportCenteredZoom ? <LockSimple size={15} weight="bold" /> : <LockSimpleOpen size={15} weight="bold" />}
        </button>
      ) : null}
      {activeGraph && graphViewMode === "2d" ? (
        <button
          className={`pageStat pageStatControl ${graphLayoutEditing ? "pageStatControlActive" : ""}`}
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
        >
          {graphLayoutEditing ? copy.graphStats.saveLayout : <PencilSimple size={13} weight="bold" />}
        </button>
      ) : null}
      {graphViewMode === "2d" && graphLayoutEditing ? (
        <button
          className="pageStat layoutCancelBtn"
          onClick={() => {
            setGraphLayoutEditing(false);
            setGraphLayoutDraft(null);
          }}
          type="button"
          title={copy.graphStats.cancelLayoutEdit}
        >
          ✕
        </button>
      ) : null}
    </>
  );
}
