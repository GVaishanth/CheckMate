/** Storage schema types. */
import type { BotStyle } from '../engine/bots';
import type { LessonProgress } from '../education/progress';

export interface MoveRecord {
  san: string;
  uci: string;
  fenAfter: string;
  msElapsed: number;
  capture: boolean;
  check: boolean;
}

export type GameMode = 'bot' | 'local' | 'p2p' | 'import' | 'elo';

export type GameOutcome =
  | { result: 'white' }
  | { result: 'black' }
  | { result: 'draw'; reason: DrawReason }
  | { result: 'unfinished' };

export type DrawReason = 'stalemate' | 'agreement' | 'threefold' | 'fifty-move' | 'insufficient' | 'disconnect';

export interface StoredGame {
  id: string;
  mode: GameMode;
  date: number;
  /** Rule variant the game was played under (default standard). */
  variant?: 'standard' | 'three-check' | 'koth';
  /** Display name for white / black seats. */
  whiteName: string;
  blackName: string;
  /** Bot metadata (bot games only). */
  botId?: string;
  botElo?: string;
  startFen: string;
  moves: MoveRecord[];
  outcome: GameOutcome;
  durationMs: number;
  pgn?: string;
  /** Post-game analysis, filled asynchronously. */
  analysis?: GameAnalysis;
}

export interface GameAnalysis {
  /** Average centipawn loss per seat. */
  whiteLossCp: number;
  blackLossCp: number;
  /** Accuracy 0..100 per seat. */
  whiteAccuracy: number;
  blackAccuracy: number;
  /** Performance rating estimate for the human player (bot games). */
  performance?: number;
  analyzedAt: number;
}

export interface PuzzleProgress {
  key: string; // puzzleId
  puzzleId: string;
  status: 'solved' | 'failed';
  attempts: number;
  bestTimeMs?: number;
  bestStreak?: number;
  solvedAt?: number;
  lastTriedAt: number;
}

export interface EloResult {
  id: string;
  date: number;
  rating: number;
  rangeLow: number;
  rangeHigh: number;
  categories: Record<string, number>;
  overall: number;
  strongest?: string;
  weakest?: string;
  rounds: number;
}

export interface ExportBundle {
  version: number;
  exportedAt: number;
  games: StoredGame[];
  puzzles: PuzzleProgress[];
  elo: EloResult[];
  settings: string | null;
  education?: LessonProgress[];
}

export interface BotRecord {
  botId: string;
  wins: number;
  losses: number;
  draws: number;
}

export type { BotStyle };
