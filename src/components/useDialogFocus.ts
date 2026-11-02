import { RefObject, useEffect, useRef, useSyncExternalStore } from 'react';

interface Dialog { panel: HTMLElement; priority: number }
const dialogs: Dialog[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const restoreTargets = new WeakMap<HTMLElement, HTMLElement | null>();
const top = () => dialogs.reduce<Dialog | undefined>((best, entry) => !best || entry.priority >= best.priority ? entry : best, undefined);
export const useActiveDialog = (): HTMLElement | null => useSyncExternalStore(subscribe, () => top()?.panel ?? null, () => null);
const items = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]'))
  .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]'));
const first = (panel: HTMLElement) => (items(panel)[0] ?? panel).focus({ preventScroll: true });
const refresh = () => {
  const active = top();
  const root = document.getElementById('root');
  if (root) root.inert = Boolean(active && !root.contains(active.panel));
  for (const { panel } of dialogs) {
    panel.inert = panel !== active?.panel;
    panel.setAttribute('aria-modal', panel === active?.panel ? 'true' : 'false');
    if (panel === active?.panel) panel.removeAttribute('aria-hidden'); else panel.setAttribute('aria-hidden', 'true');
  }
  for (const listener of listeners) listener();
};
export function useDialogFocus(ref: RefObject<HTMLElement>, onClose: () => void): void {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    restoreTargets.set(panel, previous);
    let priority = 0;
    for (let node: HTMLElement | null = panel; node; node = node.parentElement) {
      const value = Number.parseInt(getComputedStyle(node).zIndex, 10);
      if (Number.isFinite(value)) priority = Math.max(priority, value);
    }
    const entry = { panel, priority };
    panel.tabIndex = -1; dialogs.push(entry);
    if (top() === entry) first(panel);
    refresh();
    const onFocus = (event: FocusEvent) => { if (top() === entry && !panel.contains(event.target as Node)) first(panel); };
    const onKey = (event: KeyboardEvent) => {
      if (top() !== entry) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      else if (event.key === 'Tab') {
        const all = items(panel), firstItem = all[0], lastItem = all[all.length - 1];
        if (!firstItem) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === panel)) { event.preventDefault(); lastItem!.focus(); }
        else if (!event.shiftKey && (document.activeElement === lastItem || document.activeElement === panel)) { event.preventDefault(); firstItem.focus(); }
      }
    };
    document.addEventListener('focusin', onFocus); document.addEventListener('keydown', onKey, true);
    return () => {
      const wasTop = top() === entry;
      document.removeEventListener('focusin', onFocus); document.removeEventListener('keydown', onKey, true);
      dialogs.splice(dialogs.indexOf(entry), 1); refresh();
      if (!wasTop) return;
      let target = previous;
      const seen = new Set<HTMLElement>();
      while (target && !target.isConnected && !seen.has(target)) {
        seen.add(target); const owner = target.closest<HTMLElement>('[role="dialog"]');
        target = owner ? restoreTargets.get(owner) ?? null : null;
      }
      const active = top();
      if (active && (!target || !active.panel.contains(target))) first(active.panel);
      else if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [ref]);
}
