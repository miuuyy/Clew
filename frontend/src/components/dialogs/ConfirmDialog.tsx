import React from "react";

import { Modal } from "../ui/Modal";

export function ConfirmDialog({
  open,
  modalRef,
  cancelButtonRef,
  id,
  title,
  body,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  modalRef: React.RefObject<HTMLDivElement | null>;
  cancelButtonRef: React.RefObject<HTMLButtonElement | null>;
  id: string;
  title: string;
  body: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element | null {
  if (!open) return null;

  return (
    <Modal
      id={id}
      modalRef={modalRef}
      title={title}
      description={body}
      closeLabel={cancelLabel}
      onClose={onCancel}
      size="sm"
      footer={<>
        <button ref={cancelButtonRef} className="uiButton uiButtonQuiet" onClick={onCancel} type="button">{cancelLabel}</button>
        <button className="uiButton uiButtonDanger" type="button" onClick={onConfirm}>{confirmLabel}</button>
      </>}
    >
      <p className="uiModalText">{message}</p>
    </Modal>
  );
}
