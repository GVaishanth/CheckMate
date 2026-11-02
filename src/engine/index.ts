/**
 * Engine facade — the single API the rest of the application uses.
 *
 * Deterministic seeded RNG per request makes bot behaviour reproducible
 * (used by tests and by the Elo scorer).
 */
import { Position } from '../chess/position';
import { moveToUci } from '../chess/constants';
import { TranspositionTable } from './tt';
import { Searcher } from './search';
import { evaluateBasic, evaluateFull } from './evaluate';
import { BotStyle } from './bots';
import { bookMove } from './opening-book';
import { MoveScore, SearchLimits, SearchResult } from './search-types';

export interface BotDecision {
  uci: string | null;
  fromBook: boolean;
  score: number;
  depth: number;
  nodes: number;
  ms: number;
  pv: string[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sharedTt = new TranspositionTable();

export function resetTable(): void {
  sharedTt.clear();
}

/** Full engine search used by strong bots and analysis. */
export function findBestMove(
  position: Position,
  limits: SearchLimits,
  opts?: { profile?: 'basic' | 'full'; quiescence?: boolean; onDepth?: SearchResult['depth'] extends never ? never : (r: { depth: number; score: number; nodes: number; ms: number }) => void },
): SearchResult {
  const searcher = new Searcher(sharedTt);
  return searcher.search(position, limits, opts as never);
}

/** Bot move selection: book → search → personality (noise / blunder). */
export function botMove(position: Position, style: BotStyle, seed = Date.now() & 0xffffffff, onDepth?: (p: { depth: number; score: number; nodes: number; ms: number }) => void): BotDecision {
  const rng = mulberry32(seed);

  const hit = style.bookPly > 0 ? bookMove(position, rng, style.bookPly) : null;
  if (hit) {
    return { uci: hit.uci, fromBook: true, score: 0, depth: 0, nodes: 0, ms: 0, pv: [hit.uci] };
  }

  const searcher = new Searcher(sharedTt);
  const result = searcher.search(position, { maxDepth: style.depth, softMs: style.softMs }, {
    profile: style.profile,
    quiescence: style.quiescence,
    rankRoot: style.rankRoot,
    onDepth,
  });

  if (!result.rootScores.length) return { uci: null, fromBook: false, score: 0, depth: 0, nodes: 0, ms: 0, pv: [] };

  let chosen: MoveScore;
  const scores = result.rootScores.filter((s) => s.score > -900_000); // discard aborted entries

  if (!style.rankRoot || scores.length === 0) {
    chosen = result.rootScores.reduce((a, b) => (b.score > a.score ? b : a));
  } else if (rng() < style.blunderRate && scores.length > 1) {
    // Blunder: pick randomly from the weaker half of legal moves.
    const sorted = scores.slice().sort((a, b) => b.score - a.score);
    const weakHalf = sorted.slice(Math.floor(sorted.length / 2));
    chosen = weakHalf[Math.floor(rng() * weakHalf.length)] ?? sorted[sorted.length - 1]!;
  } else if (style.noiseCp > 0) {
    chosen = scores.reduce((a, b) => {
      const ja = a.score + (rng() * 2 - 1) * style.noiseCp;
      const jb = b.score + (rng() * 2 - 1) * style.noiseCp;
      return jb > ja ? b : a;
    });
  } else {
    chosen = scores.reduce((a, b) => (b.score > a.score ? b : a));
  }

  return {
    uci: moveToUci(chosen.move),
    fromBook: false,
    score: chosen.score,
    depth: result.depth,
    nodes: result.nodes,
    ms: result.ms,
    pv: result.pv.map(moveToUci),
  };
}

/** Static evaluation in centipawns from White's perspective (UI display). */
export function evaluateWhiteCp(position: Position, profile: 'basic' | 'full' = 'full'): number {
  const v = profile === 'full' ? evaluateFull(position) : evaluateBasic(position);
  return position.stm === 0 ? v : -v;
}

/** Quality of a played move vs engine best: returns centipawn loss + best move. */
export function analyzeMoveQuality(
  position: Position,
  playedUci: string,
  depth = 8,
  softMs = 500,
): { lossCp: number; bestUci: string; bestScore: number; playedScore: number } {
  const searcher = new Searcher(sharedTt);
  const before = searcher.search(position.clone(), { maxDepth: depth, softMs }, { profile: 'full', quiescence: true });
  const bestScore = before.score;
  const bestUci = moveToUci(before.bestMove);

  const after = position.clone();
  const played = after.uciToMove(playedUci);
  if (played === null) return { lossCp: 1000, bestUci, bestScore, playedScore: bestScore - 1000 };
  after.makeMove(played);

  const s2 = new Searcher(sharedTt);
  const afterResult = s2.search(after, { maxDepth: Math.max(1, depth - 1), softMs }, { profile: 'full', quiescence: true });
  const playedScore = -afterResult.score;
  return { lossCp: Math.max(0, bestScore - playedScore), bestUci, bestScore, playedScore };
}

export { BOTS, botById } from './bots';
export type { BotStyle } from './bots';
export { bookOptions, bookSize } from './opening-book';
export { Searcher } from './search';
export { TranspositionTable } from './tt';
export type { SearchLimits, SearchResult, MoveScore } from './search-types';
export { gamePhase, evaluateBasic, evaluateFull } from './evaluate';
export { Position } from '../chess/position';
