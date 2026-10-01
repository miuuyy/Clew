import React from "react";
import { UploadSimple } from "@phosphor-icons/react";

import { Modal } from "../ui/Modal";

import type { AppCopy } from "../../lib/appCopy";
import type { CreateGraphRequest } from "../../lib/types";

export function CreateGraphDialog({
  open,
  modalRef,
  closeModal,
  titleInputRef,
  draft,
  setDraft,
  error,
  loading,
  openImportObsidianModal,
  openImportGraphModal,
  createGraph,
  copy,
}: {
  open: boolean;
  modalRef: React.RefObject<HTMLDivElement | null>;
  closeModal: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  draft: CreateGraphRequest;
  setDraft: React.Dispatch<React.SetStateAction<CreateGraphRequest>>;
  error: string | null;
  loading: boolean;
  openImportObsidianModal: () => void;
  openImportGraphModal: () => void;
  createGraph: () => Promise<void>;
  copy: AppCopy;
}): React.JSX.Element | null {
  if (!open) return null;

  const patch = (next: Partial<CreateGraphRequest>): void => {
    setDraft((current) => ({ ...current, ...next }));
  };

  return (
    <Modal
      id="create-graph-dialog"
      modalRef={modalRef}
      title={copy.dialogs.createGraphTitle}
      description={copy.dialogs.createGraphBody}
      closeLabel={copy.dialogs.createGraphAria}
      onClose={closeModal}
      footer={<>
        <div className="uiModalFooterStart">
          <button className="uiButton uiButtonQuiet" onClick={openImportObsidianModal} type="button">{copy.dialogs.importFromObsidian}</button>
          <button className="uiButton uiButtonQuiet" onClick={openImportGraphModal} type="button">
            <UploadSimple size={14} aria-hidden="true" />
            <span>{copy.dialogs.importFromDisk}</span>
          </button>
        </div>
        <button
          className="uiButton uiButtonPrimary"
          disabled={loading || !draft.title.trim() || !draft.subject.trim()}
          onClick={() => void createGraph()}
          type="button"
        >
          {loading ? copy.dialogs.creating : copy.dialogs.createGraph}
        </button>
      </>}
    >
      <label className="uiField">
        <span className="uiLabel">{copy.dialogs.graphTitle}</span>
        <input ref={titleInputRef} className="uiInput" value={draft.title} onChange={(event) => patch({ title: event.target.value })} placeholder={copy.dialogs.graphTitlePlaceholder} />
      </label>
      <div className="uiFieldPair">
        <label className="uiField">
          <span className="uiLabel">{copy.dialogs.subject}</span>
          <input className="uiInput" value={draft.subject} onChange={(event) => patch({ subject: event.target.value })} placeholder={copy.dialogs.subjectPlaceholder} />
        </label>
        <label className="uiField">
          <span className="uiLabel">{copy.dialogs.language}</span>
          <select className="uiSelect" value={draft.language} onChange={(event) => patch({ language: event.target.value as CreateGraphRequest["language"] })}>
            <option value="uk">{copy.dialogs.languageOptions.uk}</option>
            <option value="ru">{copy.dialogs.languageOptions.ru}</option>
            <option value="en">{copy.dialogs.languageOptions.en}</option>
          </select>
        </label>
      </div>
      <label className="uiField">
        <span className="uiLabel">{copy.dialogs.description}</span>
        <textarea className="uiTextarea" value={draft.description} onChange={(event) => patch({ description: event.target.value })} placeholder={copy.dialogs.descriptionPlaceholder} />
      </label>
      {error ? <div className="inlineNotice inlineNoticeError">{error}</div> : null}
    </Modal>
  );
}
