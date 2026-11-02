import { describe, expect, it } from 'vitest';
import {
  buildAnnotations,
  classifyMove,
  commentFor,
  summarizeReview,
} from '../src/game/review';
import { START_FEN } from '../src/chess/constants';

describe('review classification', () => {
  it('buckets centipawn loss into kinds at the thresholds', () => {
    expect(classifyMove(0)).toBe('best');
    expect(classifyMove(20)).toBe('best');
    expect(classifyMove(21)).toBe('good');
    expect(classifyMove(70)).toBe('good');
    expect(classifyMove(71)).toBe('inaccuracy');
    expect(classifyMove(140)).toBe('inaccuracy');
    expect(classifyMove(141)).toBe('mistake');
    expect(classifyMove(280)).toBe('mistake');
    expect(classifyMove(281)).toBe('blunder');
    expect(classifyMove(600)).toBe('blunder');
  });

  it('quotes the better move for bad moves, never for best', () => {
    expect(commentFor(3, { kind: 'blunder', bestSan: 'Qh5' })).toContain('Qh5');
    expect(commentFor(9, { kind: 'mistake', bestSan: 'Nf3' })).toContain('Nf3');
    expect(commentFor(4, { kind: 'inaccuracy', bestSan: null })).not.toContain('{B}');
    expect(commentFor(1, { kind: 'best', bestSan: null })).toMatch(/[A-Z]/);
  });

  it('is deterministic per ply', () => {
    const a = commentFor(5, { kind: 'good', bestSan: null });
    const b = commentFor(5, { kind: 'good', bestSan: null });
    expect(a).toBe(b);
  });
});

describe('review annotations + summary', () => {
  const moves = [
    { san: 'e4', uci: 'e2e4' },
    { san: 'e5', uci: 'e7e5' },
    { san: 'Qh5', uci: 'd1h5' },
    { san: 'Nc6', uci: 'b8c6' },
    { san: 'Bc4', uci: 'f1c4' },
    { san: 'Nf6', uci: 'g8f6' },
    { san: 'Qxf7#', uci: 'h5f7' },
  ];
  const losses = [0, 0, 30, 0, 10, 300, 0];
  const bests: (string | null)[] = [null, null, 'd1e2', null, null, 'd8e7', null];

  it('annotates every ply and converts best uci to SAN', () => {
    const ann = buildAnnotations(START_FEN, moves, losses, bests);
    expect(ann).toHaveLength(7);
    expect(ann[2]!.kind).toBe('good');
    expect(ann[5]!.kind).toBe('blunder');
    expect(ann[5]!.bestSan).toBe('Qe7');
    expect(ann[5]!.comment).toContain('Qe7');
    expect(ann[0]!.bestSan).toBeNull();
  });

  it('summarizes accuracy and counts per side', () => {
    const ann = buildAnnotations(START_FEN, moves, losses, bests);
    const sum = summarizeReview(ann, losses);
    expect(sum.white.counts).toEqual({ best: 3, good: 1, inaccuracy: 0, mistake: 0, blunder: 0 });
    expect(sum.black.counts).toEqual({ best: 2, good: 0, inaccuracy: 0, mistake: 0, blunder: 1 });
    expect(sum.white.accuracy).toBeLessThan(100);
    expect(sum.white.accuracy).toBeGreaterThan(0);
    expect(sum.white.performance).toBeGreaterThanOrEqual(400);
    expect(sum.black.performance).toBeLessThanOrEqual(2400);
  });

  it('handles a game with zero moves', () => {
    const sum = summarizeReview([], []);
    expect(sum.white.accuracy).toBeNull();
    expect(sum.white.performance).toBeNull();
  });
});

it('does not assign accuracy to a seat that never moved', () => {
  const annotations = buildAnnotations(START_FEN, [{ san: 'e4', uci: 'e2e4' }], [0], [null]);
  const summary = summarizeReview(annotations, [0]);
  expect(summary.white.accuracy).toBe(100);
  expect(summary.black.accuracy).toBeNull();
  expect(summary.black.performance).toBeNull();
});
