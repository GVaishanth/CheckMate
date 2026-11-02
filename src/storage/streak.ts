const KEY = 'checkmate:puzzle-streak';
export interface PuzzleStreak { current: number; best: number }
let session: PuzzleStreak = { current: 0, best: 0 };
let failed = false;
const count = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000 ? n : 0;
};
export function puzzleStreak(): PuzzleStreak {
  if (!failed) {
    try {
      const current = count(localStorage.getItem(KEY));
      session = { current, best: Math.max(current, count(localStorage.getItem(`${KEY}:best`))) };
    } catch { failed = true; }
  }
  return { ...session };
}
export function restoreStreak(value: PuzzleStreak): boolean {
  session = { current: count(value.current), best: Math.max(count(value.current), count(value.best)) };
  try {
    localStorage.setItem(KEY, String(session.current));
    localStorage.setItem(`${KEY}:best`, String(session.best));
    failed = false; return true;
  } catch { failed = true; return false; }
}
export const loadStreak = () => puzzleStreak().current;
export const loadBestStreak = () => puzzleStreak().best;
export const saveStreak = (current: number) => restoreStreak({ current, best: Math.max(puzzleStreak().best, current) });
export function wipeStreak(): boolean {
  session = { current: 0, best: 0 };
  try {
    localStorage.removeItem(KEY); localStorage.removeItem(`${KEY}:best`);
    failed = false; return true;
  } catch { failed = true; return false; }
}
