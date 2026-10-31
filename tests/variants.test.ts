import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { START_FEN } from '../src/chess/constants';
import { GameController } from '../src/game/GameController';
import { Searcher } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/tt';

// Rook-ladder position: black checks along successive ranks, white king walks.
const ROOK_FEN = 'r6k/8/8/8/8/8/8/6K1 b - - 0 1';

describe('three-check', () => {
  it('counts delivered checks and undo restores the count', () => {
    const pos = Position.fromFen(ROOK_FEN);
    pos.applyVariant('three-check');
    pos.playUci('a8a1'); // Ra1+ (check 1, black)
    expect(pos.checksGiven[1]).toBe(1);
    expect(pos.checksGiven[0]).toBe(0);
    expect(pos.variantWinner()).toBeNull();
    pos.undoMove();
    expect(pos.checksGiven[1]).toBe(0);
  });

  it('third check decides the game for the checking side', () => {
    const pos = Position.fromFen(ROOK_FEN);
    pos.applyVariant('three-check');
    for (const uci of ['a8a1', 'g1g2', 'a1a2', 'g2g3', 'a2a3']) pos.playUci(uci);
    expect(pos.checksGiven[1]).toBe(3);
    expect(pos.variantWinner()).toBe(1); // black
  });

  it('the searcher finds the third check as a forced win', () => {
    const pos = Position.fromFen(ROOK_FEN);
    pos.applyVariant('three-check');
    for (const uci of ['a8a1', 'g1g2', 'a1a2', 'g2g3']) pos.playUci(uci); // two checks in
    const searcher = new Searcher(new TranspositionTable());
    const r = searcher.search(pos, { maxDepth: 4, softMs: 0 }, { profile: 'full', quiescence: true });
    expect(r.score).toBeGreaterThan(50000);
    expect(r.bestMove & 0x7f).toBe(0x10); // from a2
    // Ra3+ or Rg2+ — either rook move delivers the third check.
    expect([0x20, 0x16]).toContain((r.bestMove >> 7) & 0x7f);
  });

  it('GameController ends on the third check with the right reason', () => {
    const c = new GameController({ whiteName: 'W', blackName: 'B', variant: 'three-check' });
    // Fool's-mate shape, but stopped before mate: 1.f3 e5 2.Nc3 Qh4+ 3.g3 Qxe1?? —
    // simpler: verify via the rook ladder on a custom start.
    const c2 = new GameController({
      whiteName: 'W',
      blackName: 'B',
      variant: 'three-check',
      startFen: ROOK_FEN,
    });
    void c;
    for (const uci of ['a8a1', 'g1g2', 'a1a2', 'g2g3', 'a2a3']) expect(c2.applyUci(uci)).not.toBeNull();
    expect(c2.phase).toBe('ended');
    expect(c2.end?.reason).toBe('three-check');
    expect(c2.end?.winner).toBe('black');
  });
});

describe('king of the hill', () => {
  it('a king on a center square wins', () => {
    const pos = Position.fromFen('4k3/8/8/8/8/8/4K3/8 w - - 0 1');
    pos.applyVariant('koth');
    expect(pos.variantWinner()).toBeNull();
    pos.playUci('e2e3');
    pos.playUci('e8d7');
    pos.playUci('e3e4');
    expect(pos.kingOnHill(0)).toBe(true);
    expect(pos.variantWinner()).toBe(0); // white
  });

  it('the searcher races the king to the hill', () => {
    const pos = Position.fromFen('4k3/8/8/8/8/8/4K3/8 w - - 0 1');
    pos.applyVariant('koth');
    const searcher = new Searcher(new TranspositionTable());
    const r = searcher.search(pos, { maxDepth: 4, softMs: 0 }, { profile: 'full', quiescence: true });
    expect(r.score).toBeGreaterThan(50000);
    const to = (r.bestMove >> 7) & 0x7f;
    expect([0x23, 0x25, 0x33]).toContain(to); // e3 / f3 / d3 — all reach the hill next move
  });

  it('GameController ends with the variant reason', () => {
    const c = new GameController({
      whiteName: 'W',
      blackName: 'B',
      variant: 'koth',
      startFen: '4k3/8/8/8/8/8/4K3/8 w - - 0 1',
    });
    for (const uci of ['e2e3', 'e8d7', 'e3e4']) expect(c.applyUci(uci)).not.toBeNull();
    expect(c.phase).toBe('ended');
    expect(c.end?.reason).toBe('king-of-the-hill');
    expect(c.end?.winner).toBe('white');
  });
});

describe('variant isolation', () => {
  it('standard chess never triggers variant wins', () => {
    const pos = Position.fromFen(START_FEN);
    pos.playUci('e2e4');
    expect(pos.variantWinner()).toBeNull();
  });

  it('hash separates the same placement under different rules', () => {
    const a = Position.fromFen(START_FEN);
    const b = Position.fromFen(START_FEN);
    b.applyVariant('koth');
    expect(a.hash.lo === b.hash.lo && a.hash.hi === b.hash.hi).toBe(false);
  });

  it('clone carries variant and check counters', () => {
    const pos = Position.fromFen(ROOK_FEN);
    pos.applyVariant('three-check');
    pos.playUci('a8a1');
    const c = pos.clone();
    expect(c.variant).toBe('three-check');
    expect(c.checksGiven[1]).toBe(1);
  });

  it('move generation is untouched under standard rules', () => {
    const pos = Position.fromFen(START_FEN);
    const perft = (p: Position, d: number): number => {
      if (d === 0) return 1;
      let n = 0;
      for (const m of p.getLegalMoves()) {
        p.makeMove(m.from | (m.to << 7) | ((m.promo ?? 0) << 14));
        n += perft(p, d - 1);
        p.undoMove();
      }
      return n;
    };
    expect(perft(pos, 2)).toBe(400);
  });
});
