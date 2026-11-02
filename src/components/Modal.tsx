/** Accessible modal with focus trap + Escape handling. */
import { useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { ActionButton } from './ActionButton';
import { ToastHost, useToast } from './Toast';
import { createPortal } from 'react-dom';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  closeLabel?: string;
  busy?: boolean;
}

export function Modal({ title, onClose, children, wide, closeLabel = 'Close', busy = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const busyReason = 'An operation is still running. Wait for it to finish before closing this window.';
  const close = () => { if (busy) toast(busyReason); else onClose(); };
  useDialogFocus(panelRef, close);

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <ToastHost />
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <ActionButton className="modal-close" blockedReason={busy && busyReason} onClick={close} aria-label={closeLabel}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </ActionButton>
        </div>
        <div className="modal-body" aria-busy={busy || undefined}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
