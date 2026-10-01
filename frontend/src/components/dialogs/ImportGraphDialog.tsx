import React from "react";
import { UploadSimple } from "@phosphor-icons/react";

import { Modal } from "../ui/Modal";
import { SwitchRow } from "../ui/SwitchRow";

import type { AppCopy } from "../../lib/appCopy";
import type { GraphExportPackagePayload } from "../../lib/types";

export function ImportGraphDialog({
  open,
  modalRef,
  closeModal,
  fileInputRef,
  fileButtonRef,
  handleImportFile,
  fileName,
  payload,
  titleDraft,
  setTitleDraft,
  includeProgressDraft,
  setIncludeProgressDraft,
  error,
  loading,
  importGraphFromPackage,
  copy,
}: {
  open: boolean;
  modalRef: React.RefObject<HTMLDivElement | null>;
  closeModal: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  fileButtonRef: React.RefObject<HTMLButtonElement | null>;
  handleImportFile: (file: File) => Promise<void>;
  fileName: string | null;
  payload: GraphExportPackagePayload | null;
  titleDraft: string;
  setTitleDraft: React.Dispatch<React.SetStateAction<string>>;
  includeProgressDraft: boolean;
  setIncludeProgressDraft: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  loading: boolean;
  importGraphFromPackage: () => Promise<void>;
  copy: AppCopy;
}): React.JSX.Element | null {
  if (!open) return null;

  return (
    <Modal
      id="import-graph-dialog"
      modalRef={modalRef}
      title={copy.dialogs.importGraphTitle}
      description={copy.dialogs.importGraphBody}
      closeLabel={copy.dialogs.cancel}
      onClose={closeModal}
      footer={<>
        <button className="uiButton uiButtonQuiet" onClick={closeModal} type="button">{copy.dialogs.cancel}</button>
        <button className="uiButton uiButtonPrimary" disabled={loading || !payload || !titleDraft.trim()} onClick={() => void importGraphFromPackage()} type="button">
          {loading ? copy.dialogs.importingGraph : copy.dialogs.importGraph}
        </button>
      </>}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.mapmind-graph.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          if (file) {
            void handleImportFile(file);
          }
          event.currentTarget.value = "";
        }}
      />
      <button ref={fileButtonRef} className={`uiDropzone${fileName ? " uiDropzoneReady" : ""}`} type="button" onClick={() => fileInputRef.current?.click()}>
        <UploadSimple size={18} aria-hidden="true" />
        <span className="uiDropzoneTitle">{fileName ?? copy.dialogs.chooseFile}</span>
        <span className="uiHelp">{payload ? `${payload.graph.title} · ${payload.graph.topics.length} ${copy.library.nodes}` : copy.dialogs.noFileChosen}</span>
      </button>
      {payload ? (
        <>
          <label className="uiField">
            <span className="uiLabel">{copy.dialogs.graphTitle}</span>
            <input className="uiInput" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder={copy.dialogs.importTitlePlaceholder} />
          </label>
          <div className="uiRows">
            <SwitchRow title={copy.dialogs.importWithProgress} checked={includeProgressDraft} onChange={setIncludeProgressDraft} />
          </div>
        </>
      ) : null}
      {error ? <div className="inlineNotice inlineNoticeError">{error}</div> : null}
    </Modal>
  );
}
