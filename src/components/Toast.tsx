/** Toast notifications — bottom-center stack, auto-dismiss, ARIA live. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { uid } from '../utils';

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
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
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'danger' ? ' toast-danger' : t.kind === 'success' ? ' toast-success' : ''}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
