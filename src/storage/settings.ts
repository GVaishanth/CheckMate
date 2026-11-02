/**
 * Settings — lightweight preferences in localStorage with a typed shape,
 * versioned for forward compatibility and safe against corruption.
 */
import { createContext, useContext } from 'react';

export type BoardTheme = 'carbon' | 'tournament' | 'walnut' | 'fog';
export type PieceStyle = 'vanguard' | 'glyph';

export interface Settings {
  version: 1;
  boardTheme: BoardTheme;
  pieceStyle: PieceStyle;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  animateMoves: boolean;
  autoQueen: boolean;
  confirmMoves: boolean;
  sound: boolean;
  uiSounds: boolean; // tiny clicks for buttons/copy — separable from game audio
  volume: number; // 0..1
  reducedMotion: 'auto' | 'on';
  highContrast: boolean;
  defaultOrientation: 'white' | 'black';
  autoFlipLocal: boolean; // pass & play: flip board each turn
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  boardTheme: 'carbon',
  pieceStyle: 'vanguard',
  showCoordinates: true,
  showLegalMoves: true,
  animateMoves: true,
  autoQueen: false,
  confirmMoves: false,
  sound: true,
  uiSounds: true,
  volume: 0.7,
  reducedMotion: 'auto',
  highContrast: false,
  defaultOrientation: 'white',
  autoFlipLocal: true,
};

const KEY = 'checkmate:settings';

let sessionSettings: Settings | null = null;
let settingsFailed = false;

export function normaliseSettings(value: unknown): Settings {
  const next = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return next;
  const row = value as Record<string, unknown>;
  if (row.version !== undefined && row.version !== 1) return next;
  for (const key of ['showCoordinates', 'showLegalMoves', 'animateMoves', 'autoQueen', 'confirmMoves', 'sound', 'uiSounds', 'highContrast', 'autoFlipLocal'] as const) {
    if (typeof row[key] === 'boolean') next[key] = row[key];
  }
  if (['carbon', 'tournament', 'walnut', 'fog'].includes(row.boardTheme as string)) next.boardTheme = row.boardTheme as BoardTheme;
  if (row.pieceStyle === 'vanguard' || row.pieceStyle === 'glyph') next.pieceStyle = row.pieceStyle;
  if (row.reducedMotion === 'auto' || row.reducedMotion === 'on') next.reducedMotion = row.reducedMotion;
  if (row.defaultOrientation === 'white' || row.defaultOrientation === 'black') next.defaultOrientation = row.defaultOrientation;
  if (typeof row.volume === 'number' && Number.isFinite(row.volume)) next.volume = Math.max(0, Math.min(1, row.volume));
  return next;
}

export function loadSettings(): Settings {
  if (settingsFailed && sessionSettings) return { ...sessionSettings };
  try {
    const raw = localStorage.getItem(KEY);
    sessionSettings = normaliseSettings(raw ? JSON.parse(raw) : null);
    return { ...sessionSettings };
  } catch {
    return { ...(sessionSettings ?? DEFAULT_SETTINGS) };
  }
}

export function saveSettings(value: Settings): boolean {
  sessionSettings = normaliseSettings(value);
  try {
    localStorage.setItem(KEY, JSON.stringify(sessionSettings));
    settingsFailed = false; return true;
  } catch { settingsFailed = true; return false; }
}

export function wipeSettings(): boolean {
  sessionSettings = null;
  try { localStorage.removeItem(KEY); settingsFailed = false; return true; }
  catch { settingsFailed = true; return false; }
}

// React context for the settings store (set up in App).
export interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  storageOk: boolean;
}

export const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => undefined,
  reset: () => undefined,
  storageOk: true,
});

export const useSettings = (): SettingsContextValue => useContext(SettingsContext);

/** Effective reduced-motion flag (setting + media query). */
export const effectiveReducedMotion = (s: Settings): boolean =>
  s.reducedMotion === 'on' ||
  (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
