/** Toast notifications — bottom-center stack, auto-dismiss, ARIA live. */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { uid } from '../utils';
import { useActiveDialog } from './useDialogFocus';

export interface ToastItem {
  id: string;
  message: string;
  kind?: 'default' | 'danger' | 'success';
  durationMs?: number;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastItem['kind'], durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export const useToast = (): ToastContextValue => useContext(ToastContext);

export function ToastHost({ hostRef }: { hostRef?: RefObject<HTMLDivElement> }) {
  const id = useId();
  return <div id={id} ref={hostRef} data-toast-host className="toast-stack" role="status" aria-live="polite" aria-atomic="true" />;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const dialog = useActiveDialog();
  const target = dialog?.querySelector<HTMLElement>('[data-toast-host]') ?? host.current;
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastItem['kind'] = 'default', durationMs = 3600) => {
      const id = uid();
      setItems((prev) => [...prev.slice(-3), { id, message, kind }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss],
  );

  useEffect(() => () => { for (const t of timers.current.values()) window.clearTimeout(t); }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastHost hostRef={host} />
      {target && createPortal(items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'danger' ? ' toast-danger' : t.kind === 'success' ? ' toast-success' : ''}`}>
            <span>{t.message}</span>
          </div>
        )), target)}
    </ToastContext.Provider>
  );
}
