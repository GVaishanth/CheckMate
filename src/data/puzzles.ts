/**
 * Bundled puzzle set — generated offline by scripts/generate-puzzles.ts
 * (self-play harvest, verified by this repo's own engine). No network needed.
 */
import raw from './puzzles.json';

export type PuzzleCategory =
  | 'checkmate' | 'fork' | 'pin' | 'skewer' | 'discovered'
  | 'sacrifice' | 'back-rank' | 'endgame' | 'mixed';

export interface Puzzle {
  id: string;
  fen: string;
  category: PuzzleCategory;
  difficulty: 1 | 2 | 3 | 4;
  sideToMove: 'white' | 'black';
  /** Full engine PV (uci); even indices are the solver's moves. */
  line: string[];
  /** Key solver moves (shown on reveal, used for hints). */
  solution: string[];
  motif: string;
}

const data = raw as { version: number; count: number; puzzles: Puzzle[] };

export const PUZZLES: Puzzle[] = data.puzzles;
export const PUZZLE_COUNT = data.count;

export const CATEGORY_LABELS: Array<{ id: PuzzleCategory | 'all'; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'checkmate', label: 'CHECKMATE' },
  { id: 'fork', label: 'FORK' },
  { id: 'pin', label: 'PIN' },
  { id: 'skewer', label: 'SKEWER' },
  { id: 'discovered', label: 'DISCOVERED' },
  { id: 'sacrifice', label: 'SACRIFICE' },
  { id: 'back-rank', label: 'BACK RANK' },
  { id: 'endgame', label: 'ENDGAME' },
  { id: 'mixed', label: 'MIXED' },
];

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'EASY',
  2: 'MEDIUM',
  3: 'HARD',
  4: 'EXPERT',
};

export function puzzlesMatching(category: PuzzleCategory | 'all', difficulty: number | 'all'): Puzzle[] {
  return PUZZLES.filter(
    (p) => (category === 'all' || p.category === category) && (difficulty === 'all' || p.difficulty === difficulty),
  );
}
