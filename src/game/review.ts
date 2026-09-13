/**
 * Post-game review — THE ANNOTATOR. Move classification, commentary and
 * per-side summary math. Pure functions; the engine work (loss + best move
 * per ply, depth 6) happens in the worker via engineClient.analyzeReview.
 */
import { Position } from '../chess/position';
import { moveToSan } from '../chess/san';
import { PieceType } from '../chess/constants';
import { accuracyFromLoss, performanceRating } from './analysis';

export const REVIEWER = {
  name: 'THE ANNOTATOR',
  role: 'POST-GAME REVIEWER',
};

export type MoveKind = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const KIND_ORDER: MoveKind[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

/** Depth-6 loss thresholds; generous to engine noise at review depth. */
export function classifyMove(lossCp: number): MoveKind {
  if (lossCp <= 20) return 'best';
  if (lossCp <= 70) return 'good';
  if (lossCp <= 140) return 'inaccuracy';
  if (lossCp <= 280) return 'mistake';
  return 'blunder';
}

export interface PlyAnnotation {
  san: string;
  kind: MoveKind;
  comment: string;
  bestSan: string | null;
}

const GOOD_LINES = [
  "The engine's first choice. Nothing better exists.",
  'Exactly what the position demands.',
  'Precise. Every square accounted for.',
  'Clean — the strongest continuation.',
];

const OK_LINES = [
  'Solid. The engine barely prefers anything else.',
  'Playable and sound.',
  'A natural move. Little is lost.',
  'Holds the position together.',
];

const DRIFT_LINES = [
  'This drifts. Better was {B}.',
  'Slightly off-course — {B} asked to be played.',
  'A shade imprecise. {B} keeps the balance.',
];

const SLIP_LINES = [
  'A real slip. {B} keeps the fight.',
  'Ground handed over — {B} was much stronger.',
  'The position wanted {B}.',
];

const CRASH_LINES = [
  'A crash. {B} was necessary.',
  'This loses material. {B} first.',
  'The tactic punishes this — {B} avoids it.',
];

/** Deterministic per-ply commentary — same game, same lines, every replay. */
export function commentFor(ply: number, a: { kind: MoveKind; bestSan: string | null }): string {
  switch (a.kind) {
    case 'best':
      return GOOD_LINES[ply % GOOD_LINES.length]!;
    case 'good':
      return OK_LINES[ply % OK_LINES.length]!;
    case 'inaccuracy':
    case 'mistake':
    case 'blunder': {
      const table = a.kind === 'inaccuracy' ? DRIFT_LINES : a.kind === 'mistake' ? SLIP_LINES : CRASH_LINES;
      const line = table[ply % table.length]!;
      if (a.bestSan) return line.replace('{B}', a.bestSan);
      return a.kind === 'inaccuracy' ? 'This drifts a little.' : a.kind === 'mistake' ? 'A slip — the advantage moves.' : 'A blunder. The position punishes it.';
    }
  }
}

/**
 * Build the annotation for every ply. `bests[i]` is the engine's better move
 * (null when the played move was already best); it is rendered as SAN on the
 * position before the ply so the commentary can quote it.
 */
export function buildAnnotations(
  startFen: string,
  moves: { san: string; uci: string }[],
  losses: number[],
  bests: (string | null)[],
): PlyAnnotation[] {
  const pos = Position.fromFen(startFen);
  const out: PlyAnnotation[] = [];
  for (let i = 0; i < moves.length; i++) {
    const rec = moves[i]!;
    const kind = classifyMove(losses[i] ?? 0);
    let bestSan: string | null = null;
    const bestUci = bests[i];
    if (bestUci && kind !== 'best') {
      const enc = pos.uciToMove(bestUci);
      if (enc !== null) {
        bestSan = moveToSan(pos, {
          from: enc & 0x7f,
          to: (enc >> 7) & 0x7f,
          promo: (((enc >> 14) & 7) || null) as PieceType | null,
          flag: (enc >> 17) & 7,
        });
      }
    }
    out.push({ san: rec.san, kind, bestSan, comment: commentFor(i, { kind, bestSan }) });
    try {
      pos.playUci(rec.uci);
    } catch {
      break;
    }
  }
  return out;
}

export interface SideSummary {
  accuracy: number;
  performance: number | null;
  counts: Record<MoveKind, number>;
}

export interface ReviewSummary {
  white: SideSummary;
  black: SideSummary;
}

export function summarizeReview(annotations: PlyAnnotation[], losses: number[]): ReviewSummary {
  const side = (white: boolean): SideSummary => {
    const counts: Record<MoveKind, number> = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let total = 0;
    let sum = 0;
    annotations.forEach((a, i) => {
      if ((i % 2 === 0) !== white) return;
      counts[a.kind]++;
      total++;
      sum += losses[i] ?? 0;
    });
    if (total === 0) return { accuracy: 100, performance: null, counts };
    const avg = sum / total;
    return {
      accuracy: Math.round(accuracyFromLoss(avg)),
      performance: Math.round(performanceRating(avg)),
      counts,
    };
  };
  return { white: side(true), black: side(false) };
}
