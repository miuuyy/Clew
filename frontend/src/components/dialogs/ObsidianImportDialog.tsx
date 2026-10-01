import React from "react";
import { FolderOpen } from "@phosphor-icons/react";

import { Modal } from "../ui/Modal";
import { SwitchRow } from "../ui/SwitchRow";

import type { AppCopy } from "../../lib/appCopy";
import type { ObsidianImportOptions, ObsidianImportPreview } from "../../lib/obsidianImport";
import type { CreateGraphRequest } from "../../lib/types";

type ObsidianIssue = ObsidianImportPreview["issues"][number];

type ObsidianImportDraft = Omit<ObsidianImportOptions, "vaultName">;

export function ObsidianImportDialog({
  open,
  modalRef,
  closeModal,
  folderInputRef,
  folderButtonRef,
  handleVaultFiles,
  vaultName,
  draft,
  setDraft,
  preview,
  issues,
  warnings,
  errors,
  loading,
  error,
  importGraphFromObsidian,
  copy,
}: {
  open: boolean;
  modalRef: React.RefObject<HTMLDivElement | null>;
  closeModal: () => void;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  folderButtonRef: React.RefObject<HTMLButtonElement | null>;
  handleVaultFiles: (files: FileList | null) => Promise<void>;
  vaultName: string | null;
  draft: ObsidianImportDraft;
  setDraft: React.Dispatch<React.SetStateAction<ObsidianImportDraft>>;
  preview: ObsidianImportPreview | null;
  issues: ObsidianIssue[];
  warnings: ObsidianIssue[];
  errors: ObsidianIssue[];
  loading: boolean;
  error: string | null;
  importGraphFromObsidian: () => Promise<void>;
  copy: AppCopy;
}): React.JSX.Element | null {
  if (!open) return null;

  const patch = (next: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...next }));
  return (
    <Modal
      id="import-obsidian-dialog"
      modalRef={modalRef}
      title={copy.dialogs.importObsidianTitle}
      description={copy.dialogs.importObsidianBody}
      closeLabel={copy.dialogs.cancel}
      onClose={closeModal}
      size="lg"
      footer={<>
        <button className="uiButton uiButtonQuiet" onClick={closeModal} type="button">{copy.dialogs.cancel}</button>
        <button
          className="uiButton uiButtonPrimary"
          disabled={loading || !preview?.package || !draft.graphTitle.trim() || !draft.subject.trim()}
          onClick={() => void importGraphFromObsidian()}
          type="button"
        >
          {loading ? copy.dialogs.importingObsidian : copy.dialogs.importFromObsidian}
        </button>
      </>}
    >
      <input
        ref={folderInputRef}
        type="file"
        hidden
        onChange={(event) => {
          void handleVaultFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <button ref={folderButtonRef} className={`uiDropzone${vaultName ? " uiDropzoneReady" : ""}`} type="button" onClick={() => folderInputRef.current?.click()}>
        <FolderOpen size={18} aria-hidden="true" />
        <span className="uiDropzoneTitle">{vaultName ?? copy.dialogs.chooseVaultFolder}</span>
        <span className="uiHelp">{vaultName ? copy.dialogs.obsidianVault : copy.dialogs.noVaultChosen}</span>
      </button>

      {vaultName ? (
        <>
          <div className="uiFieldPair">
            <label className="uiField">
              <span className="uiLabel">{copy.dialogs.graphTitle}</span>
              <input className="uiInput" value={draft.graphTitle} onChange={(event) => patch({ graphTitle: event.target.value })} placeholder={copy.dialogs.graphTitlePlaceholder} />
            </label>
            <label className="uiField">
              <span className="uiLabel">{copy.dialogs.obsidianSubject}</span>
              <input className="uiInput" value={draft.subject} onChange={(event) => patch({ subject: event.target.value })} placeholder={copy.dialogs.obsidianSubjectPlaceholder} />
            </label>
            <label className="uiField">
              <span className="uiLabel">{copy.dialogs.language}</span>
              <select className="uiSelect" value={draft.language} onChange={(event) => patch({ language: event.target.value as CreateGraphRequest["language"] })}>
                <option value="uk">{copy.dialogs.languageOptions.uk}</option>
                <option value="ru">{copy.dialogs.languageOptions.ru}</option>
                <option value="en">{copy.dialogs.languageOptions.en}</option>
              </select>
            </label>
            <label className="uiField">
              <span className="uiLabel">{copy.dialogs.obsidianRelation}</span>
              <select className="uiSelect" value={draft.relation} onChange={(event) => patch({ relation: event.target.value as ObsidianImportOptions["relation"] })}>
                <option value="requires">{copy.dialogs.obsidianRelationOptions.requires}</option>
                <option value="supports">{copy.dialogs.obsidianRelationOptions.supports}</option>
                <option value="bridges">{copy.dialogs.obsidianRelationOptions.bridges}</option>
                <option value="extends">{copy.dialogs.obsidianRelationOptions.extends}</option>
                <option value="reviews">{copy.dialogs.obsidianRelationOptions.reviews}</option>
              </select>
              <span className="uiHelp">{copy.dialogs.obsidianRelationHelp}</span>
            </label>
          </div>

          <div className="uiRows">
            <SwitchRow title={copy.dialogs.obsidianFoldersAsZones} help={copy.dialogs.obsidianFoldersAsZonesHelp} checked={draft.useFoldersAsZones} onChange={(checked) => patch({ useFoldersAsZones: checked })} />
            <SwitchRow title={copy.dialogs.obsidianAutofillDescriptions} help={copy.dialogs.obsidianAutofillDescriptionsHelp} checked={draft.autofillDescriptions} onChange={(checked) => patch({ autofillDescriptions: checked })} />
            <SwitchRow title={copy.dialogs.obsidianCreateArtifacts} help={copy.dialogs.obsidianCreateArtifactsHelp} checked={draft.createArtifactsFromNotes} onChange={(checked) => patch({ createArtifactsFromNotes: checked })} />
            <SwitchRow title={copy.dialogs.obsidianCreatePlaceholders} help={copy.dialogs.obsidianCreatePlaceholdersHelp} checked={draft.createPlaceholderTopics} onChange={(checked) => patch({ createPlaceholderTopics: checked })} />
          </div>

          {preview ? (
            <>
              <div className="uiStats">
                <span><strong>{preview.noteCount}</strong> {copy.dialogs.obsidianNotesCount}</span>
                <span className={warnings.length ? "uiStatsWarn" : undefined}><strong>{warnings.length}</strong> {copy.dialogs.obsidianWarningsCount}</span>
                <span className={errors.length ? "uiStatsBad" : undefined}><strong>{errors.length}</strong> {copy.dialogs.obsidianErrorsCount}</span>
              </div>
              {errors.length > 0 ? <div className="inlineNotice inlineNoticeError">{copy.dialogs.obsidianImportBlocked}</div> : null}
              {issues.length === 0 ? (
                <div className="inlineNotice inlineNoticeSuccess">{copy.dialogs.obsidianNoIssues}</div>
              ) : (
                <ul className="uiIssueList">
                  {issues.map((issue, index) => (
                    <li key={`${issue.code}-${index}`} className={issue.level === "error" ? "uiIssueBad" : "uiIssueWarn"}>{issue.message}</li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </>
      ) : null}

      {error ? <div className="inlineNotice inlineNoticeError">{error}</div> : null}
    </Modal>
  );
}
