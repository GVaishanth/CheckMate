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

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parsed, version: 1 };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* unavailable — session-only */
  }
}

export function wipeSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
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
