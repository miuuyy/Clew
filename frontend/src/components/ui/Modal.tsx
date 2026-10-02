import React from "react";
import { X } from "@phosphor-icons/react";
import { useModalAccessibility } from "../../lib/useModalAccessibility";

export type ModalSize = "sm" | "md" | "lg";

/** One dialog surface: header, scrolling body, optional footer of actions. */
export function Modal({
  id,
  modalRef,
  closeButtonRef,
  title,
  description,
  meta,
  closeLabel,
  onClose,
  size = "md",
  closeOnBackdrop = false,
  footer,
  children,
}: {
  id: string;
  modalRef?: React.Ref<HTMLDivElement>;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
  title: React.ReactNode;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const ownModalRef = React.useRef<HTMLDivElement | null>(null);
  const ownCloseRef = React.useRef<HTMLButtonElement | null>(null);
  useModalAccessibility({ isOpen: !modalRef, modalRef: ownModalRef, onClose, initialFocusRef: ownCloseRef });
  return (
    <div className="uiOverlay" onMouseDown={closeOnBackdrop ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}>
      <div
        ref={modalRef ?? ownModalRef}
        className={`uiModal uiModal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
      >
        <header className="uiModalHeader">
          <div className="uiModalHeading">
            <h2 id={`${id}-title`}>{title}</h2>
            {description ? <p id={`${id}-description`}>{description}</p> : null}
            {meta}
          </div>
          <button ref={closeButtonRef ?? ownCloseRef} className="uiIconButton" onClick={onClose} type="button" aria-label={closeLabel}>
            <X size={15} weight="bold" aria-hidden="true" />
          </button>
        </header>
        <div className="uiModalBody">{children}</div>
        {footer ? <footer className="uiModalFooter">{footer}</footer> : null}
      </div>
    </div>
  );
}
