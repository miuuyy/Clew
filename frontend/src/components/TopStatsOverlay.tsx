import React from "react";

import type { AppCopy } from "../lib/appCopy";
import type { GraphAssessment, GraphEnvelope, WorkspaceEnvelope } from "../lib/types";
import { GraphStatItems, OverlayControls, type GraphViewMode } from "./WorkspaceShellOverlayControls";

type GraphSummary = {
  topicCount: number;
  completedPercent: number;
  completedCount: number;
  reviewCount: number;
};

export type TopStatsOverlayProps = {
  visible: boolean;
  wrapperClassName: string;
  wrapperStyle: React.CSSProperties;
  floatingStatsRef: React.RefObject<HTMLDivElement | null>;
  activeGraph: GraphEnvelope | null;
  graphSummary: GraphSummary;
  copy: AppCopy;
  activeAssessmentCards: GraphAssessment["cards"];
  data: WorkspaceEnvelope | null;
  assessmentError: string | null;
  configSaving: boolean;
  error: string | null;
  graphLayoutEditing: boolean;
  graphLayoutSaving: boolean;
  topOverlayCompact: boolean;
  isMobileViewport: boolean;
  themeMode: "light" | "dark";
  setThemeMode: React.Dispatch<React.SetStateAction<"light" | "dark">>;
  viewportCenteredZoom: boolean;
  setViewportCenteredZoom: React.Dispatch<React.SetStateAction<boolean>>;
  saveGraphLayout: () => Promise<void>;
  startGraphLayoutEdit: () => void;
  setGraphLayoutEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setGraphLayoutDraft: React.Dispatch<
    React.SetStateAction<Record<string, { x: number; y: number }> | null>
  >;
  graphViewMode: GraphViewMode;
  setGraphViewMode: React.Dispatch<React.SetStateAction<GraphViewMode>>;
};

/**
 * Shared top-overlay strip that renders graph stats + overlay controls.
 * At most one variant is rendered on screen; mobile / compact-desktop /
 * inline-desktop variants pass different `wrapperClassName` and
 * `wrapperStyle`, everything else is identical.
 */
export function TopStatsOverlay({
  visible,
  wrapperClassName,
  wrapperStyle,
  floatingStatsRef,
  activeGraph,
  graphSummary,
  copy,
  activeAssessmentCards,
  data,
  assessmentError,
  configSaving,
  error,
  graphLayoutEditing,
  graphLayoutSaving,
  topOverlayCompact,
  isMobileViewport,
  themeMode,
  setThemeMode,
  viewportCenteredZoom,
  setViewportCenteredZoom,
  saveGraphLayout,
  startGraphLayoutEdit,
  setGraphLayoutEditing,
  setGraphLayoutDraft,
  graphViewMode,
  setGraphViewMode,
}: TopStatsOverlayProps): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <div
        ref={floatingStatsRef}
        className="floatingStatsContainer floatingStatsContainerStacked"
        onWheel={(event) => {
          const strip = floatingStatsRef.current;
          if (!strip) return;
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          strip.scrollLeft += event.deltaY;
          event.preventDefault();
        }}
      >
        <GraphStatItems
          activeGraph={activeGraph}
          graphSummary={graphSummary}
          copy={copy}
          activeAssessmentCards={activeAssessmentCards}
          data={data}
          assessmentError={assessmentError}
          configSaving={configSaving}
          error={error}
          graphLayoutEditing={graphLayoutEditing}
          topOverlayCompact={topOverlayCompact}
          isMobileViewport={isMobileViewport}
        />
      </div>
      <div className="floatingStatusContainer floatingStatusContainerCompact">
        <OverlayControls
          activeGraph={activeGraph}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
          viewportCenteredZoom={viewportCenteredZoom}
          setViewportCenteredZoom={setViewportCenteredZoom}
          graphLayoutEditing={graphLayoutEditing}
          saveGraphLayout={saveGraphLayout}
          startGraphLayoutEdit={startGraphLayoutEdit}
          graphLayoutSaving={graphLayoutSaving}
          copy={copy}
          setGraphLayoutEditing={setGraphLayoutEditing}
          setGraphLayoutDraft={setGraphLayoutDraft}
          graphViewMode={graphViewMode}
          setGraphViewMode={setGraphViewMode}
        />
      </div>
    </div>
  );
}
