"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icons";

export function Modal({ children, titleId, onClose, className = "" }: { children: React.ReactNode; titleId: string; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // React may detach the dialog before the browser's native focus restore.
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog ref={ref} className={`gallery-dialog ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dialog-inner">
        <button className="icon-button dialog-close" aria-label="閉じる" onClick={onClose}><Icon name="close" /></button>
        {children}
      </div>
    </dialog>
  );
}
