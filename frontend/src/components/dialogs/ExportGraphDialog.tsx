import React from "react";

import { Modal } from "../ui/Modal";
import { SwitchRow } from "../ui/SwitchRow";

import type { AppCopy } from "../../lib/appCopy";
import type { GraphEnvelope, GraphExportFormat, ObsidianExportOptions } from "../../lib/types";

function patchObsidianExportOptions(
  setOptions: React.Dispatch<React.SetStateAction<ObsidianExportOptions>>,
  patch: Partial<ObsidianExportOptions>,
): void {
  setOptions((current) => ({ ...current, ...patch }));
}

export function ExportGraphDialog({
  target,
  modalRef,
  titleInputRef,
  closeModal,
  titleDraft,
  setTitleDraft,
  includeProgressDraft,
  setIncludeProgressDraft,
  formatDraft,
  setFormatDraft,
  obsidianOptionsDraft,
  setObsidianOptionsDraft,
  error,
  loading,
  exportGraph,
  copy,
}: {
  target: GraphEnvelope | null;
  modalRef: React.RefObject<HTMLDivElement | null>;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  closeModal: () => void;
  titleDraft: string;
  setTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  includeProgressDraft: boolean;
  setIncludeProgressDraft: React.Dispatch<React.SetStateAction<boolean>>;
  formatDraft: GraphExportFormat;
  setFormatDraft: React.Dispatch<React.SetStateAction<GraphExportFormat>>;
  obsidianOptionsDraft: ObsidianExportOptions;
  setObsidianOptionsDraft: React.Dispatch<React.SetStateAction<ObsidianExportOptions>>;
  error: string | null;
  loading: boolean;
  exportGraph: (graph: GraphEnvelope) => Promise<void>;
  copy: AppCopy;
}): React.JSX.Element | null {
  if (!target) return null;

  const obsidian = formatDraft === "mapmind_obsidian_export";
  return (
    <Modal
      id="export-graph-dialog"
      modalRef={modalRef}
      title={copy.dialogs.exportGraphTitle}
      description={copy.dialogs.exportGraphBody}
      closeLabel={copy.dialogs.cancel}
      onClose={closeModal}
      footer={<>
        <button className="uiButton uiButtonQuiet" onClick={closeModal} type="button">{copy.dialogs.cancel}</button>
        <button className="uiButton uiButtonPrimary" disabled={loading || !titleDraft.trim()} onClick={() => void exportGraph(target)} type="button">
          {loading ? copy.dialogs.exportingGraph : copy.dialogs.exportGraph}
        </button>
      </>}
    >
      <div className="uiFieldPair">
        <label className="uiField">
          <span className="uiLabel">{copy.dialogs.graphTitle}</span>
          <input ref={titleInputRef} className="uiInput" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder={copy.dialogs.exportTitlePlaceholder} />
        </label>
        <label className="uiField">
          <span className="uiLabel">{copy.dialogs.exportFormat}</span>
          <select className="uiSelect" value={formatDraft} onChange={(event) => setFormatDraft(event.target.value as GraphExportFormat)}>
            <option value="mapmind_graph_export">{copy.dialogs.exportFormatClew}</option>
            <option value="mapmind_obsidian_export">{copy.dialogs.exportFormatObsidian}</option>
          </select>
        </label>
      </div>
      <div className="uiRows">
        <SwitchRow title={copy.dialogs.includeOwnProgress} checked={includeProgressDraft} onChange={setIncludeProgressDraft} />
        {obsidian ? <>
          <SwitchRow title={copy.dialogs.obsidianUseFoldersAsZones} help={copy.dialogs.obsidianUseFoldersAsZonesHelp} checked={obsidianOptionsDraft.use_folders_as_zones} onChange={(checked) => patchObsidianExportOptions(setObsidianOptionsDraft, { use_folders_as_zones: checked })} />
          <SwitchRow title={copy.dialogs.obsidianIncludeDescriptions} checked={obsidianOptionsDraft.include_descriptions} onChange={(checked) => patchObsidianExportOptions(setObsidianOptionsDraft, { include_descriptions: checked })} />
          <SwitchRow title={copy.dialogs.obsidianIncludeResources} checked={obsidianOptionsDraft.include_resources} onChange={(checked) => patchObsidianExportOptions(setObsidianOptionsDraft, { include_resources: checked })} />
          <SwitchRow title={copy.dialogs.obsidianIncludeArtifacts} checked={obsidianOptionsDraft.include_artifacts} onChange={(checked) => patchObsidianExportOptions(setObsidianOptionsDraft, { include_artifacts: checked })} />
        </> : null}
      </div>
      {obsidian ? <p className="uiHelp">{copy.dialogs.obsidianExportHint}</p> : null}
      {error ? <div className="inlineNotice inlineNoticeError">{error}</div> : null}
    </Modal>
  );
}
