import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { GameController } from '../src/game/GameController';
import { TranspositionTable, TT_EXACT } from '../src/engine/tt';
import { Searcher } from '../src/engine/search';
import { moveToUci } from '../src/chess/constants';

describe('hashing and transpositions', () => {
  it.each([0x12345678, 0x87654321, 0xffffffff, -1])('retrieves high key %s without signedness loss', (hi) => {
    const tt = new TranspositionTable(); tt.store(0x31415926, hi, 6, 230, TT_EXACT, 12345);
    expect(tt.probe(0x31415926, hi)).toEqual({ depth: 6, score: 230, flag: TT_EXACT, move: 12345 });
    expect(tt.probe(0x31415926, (hi ^ 1) >>> 0)).toBeNull();
  });
  it('counts the starting position toward threefold repetition', () => {
    const c = new GameController({ whiteName: 'W', blackName: 'B' });
    for (const uci of ['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1','f6g8']) expect(c.applyUci(uci)).not.toBeNull();
    expect(c.position.repetitionCount()).toBe(3); expect(c.end?.reason).toBe('threefold');
  });
  it('keeps a rebuilt hash identical after every move and speculative search', () => {
    const p = Position.initial();
    for (const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','g8f6','e1g1','f8e7','d2d3','e8g8']) {
      p.playUci(uci); expect(p.hash).toEqual(Position.fromFen(p.fen()).hash);
    }
    const history = [...p.moves], hash = { ...p.hash };
    new Searcher(new TranspositionTable()).search(p, { maxDepth: 3, softMs: 100 });
    expect(p.moves).toEqual(history); expect(p.hash).toEqual(hash);
  });
});

describe('search terminal states', () => {
  it('prefers checkmate over the fifty-move clock', () => {
    const p = Position.fromFen('7k/8/5KQ1/8/8/8/8/8 w - - 99 1');
    const r = new Searcher(new TranspositionTable()).search(p, { maxDepth: 2, softMs: 500 });
    expect(moveToUci(r.bestMove)).toBe('g6g7'); expect(r.score).toBeGreaterThan(90_000);
  });
  it('does not search on after a king-of-the-hill win', () => {
    const p = Position.fromFen('7k/8/8/8/3K4/8/8/8 w - - 0 1'); p.applyVariant('koth');
    const r = new Searcher(new TranspositionTable()).search(p, { maxDepth: 4, softMs: 100 });
    expect(r.bestMove).toBe(0); expect(r.score).toBeGreaterThan(90_000);
  });
  it('does not propose a move in a dead standard position', () => {
    const p = Position.fromFen('7k/8/8/8/8/8/8/K7 w - - 0 1');
    const r = new Searcher(new TranspositionTable()).search(p, { maxDepth: 4, softMs: 100 });
    expect(r.bestMove).toBe(0); expect(r.score).toBe(0);
  });
});
