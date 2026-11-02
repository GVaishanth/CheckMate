/** Small shared utilities. */

export const uid = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatNodes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the local selection fallback */ }
  let area: HTMLTextAreaElement | null = null;
  const previous = document.activeElement as HTMLElement | null;
  try {
    area = document.createElement('textarea'); area.value = text; area.readOnly = true; area.tabIndex = -1;
    area.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;';
    (previous?.closest('[role="dialog"]') ?? document.body).appendChild(area);
    area.focus({ preventScroll: true }); area.select();
    return document.execCommand('copy');
  } catch { return false; }
  finally { area?.remove(); if (previous?.isConnected) previous.focus({ preventScroll: true }); }
}

export function downloadFile(filename: string, content: string, type = 'text/plain'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

