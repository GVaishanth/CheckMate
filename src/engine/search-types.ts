/** Shared engine types (kept dependency-light so worker + main + scripts share them). */
export const MATE_SCORE = 100_000;
export const MATE_BOUND = 90_000;

export interface SearchLimits {
  maxDepth: number;
  softMs: number; // 0 = unlimited
}

export interface MoveScore {
  move: number;
  score: number;
}

export interface SearchResult {
  bestMove: number;
  score: number;
  depth: number;
  nodes: number;
  ms: number;
  pv: number[];
  rootScores: MoveScore[];
}
