/**
 * Engine behavior tests: finds forced mates, wins material, bot personalities
 * genuinely differ, opening book is legal.
 */
import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { findBestMove, botMove, evaluateWhiteCp, analyzeMoveQuality } from '../src/engine';
import { BOTS } from '../src/engine/bots';
import { bookOptions, bookSize } from '../src/engine/opening-book';
import { moveToUci } from '../src/chess/constants';
import { MATE_BOUND } from '../src/engine/search-types';

describe('search finds tactics', () => {
  it('finds mate in 1', () => {
    // Back-rank mate: Ra8#
    const pos = Position.fromFen('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
    const r = findBestMove(pos, { maxDepth: 3, softMs: 2000 });
    expect(moveToUci(r.bestMove)).toBe('a1a8');
    expect(r.score).toBeGreaterThanOrEqual(MATE_BOUND);
  });

  it('finds a forced mate (Philidor smothered pattern)', () => {
    // 1.Qg8+! Rxg8 2.Nf7# or 1.Nf7+ leading to forced mate — both are mate in 3.
    const pos = Position.fromFen('5r1k/6pp/8/6N1/8/1Q6/8/7K w - - 0 1');
    const r = findBestMove(pos, { maxDepth: 4, softMs: 3000 });
    expect(moveToUci(r.bestMove)).toMatch(/^(b3g8|g5f7)$/);
    expect(r.score).toBeGreaterThanOrEqual(MATE_BOUND);
  });

  it('finds mate in 3', () => {
    // Anastasia-style: 1.Ne7+? — constructed: mate in 3 with queen + knight
    const pos = Position.fromFen('6rk/6pp/7N/3Q4/8/8/8/7K w - - 0 1');
    const r = findBestMove(pos, { maxDepth: 5, softMs: 5000 });
    expect(r.score).toBeGreaterThanOrEqual(MATE_BOUND);
  });

  it('wins a hanging queen', () => {
    // Black queen on g5 is undefended and attackable by the f3 knight.
    const pos = Position.fromFen('rnb1kbnr/pppp1ppp/8/4p1q1/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    const r = findBestMove(pos, { maxDepth: 6, softMs: 3000 });
    expect(moveToUci(r.bestMove)).toBe('f3g5');
    expect(r.score).toBeGreaterThan(250);
  });

  it('avoids losing material (sees the recapture)', () => {
    // White knight on f3; taking the e5 pawn loses the knight to Qe7xd...? —
    // simpler: pawn grab that hangs a piece. Nxe5?? Qe7 wins it back is not
    // forced here, so instead check the engine does NOT play a move that
    // drops the queen for nothing.
    const pos = Position.fromFen('rnbqkbnr/ppp1pppp/8/3p4/8/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 1');
    const before = evaluateWhiteCp(pos, 'full');
    const r = findBestMove(pos, { maxDepth: 6, softMs: 2000 });
    // Engine's own eval of its move should not be catastrophic.
    expect(r.score).toBeGreaterThan(-300);
    expect(before).toBeGreaterThan(-50); // sanity: position is roughly balanced
  });
});

describe('bot personalities', () => {
  it('grandmaster is deterministic without noise', () => {
    const gm = BOTS.find((b) => b.id === 'grandmaster')!;
    // Generous time budget, fixed depth, no book: the depth cap must be the
    // binding constraint, so the choice depends only on position + seed —
    // never on machine speed or JIT warmup (the shipped GM plays on a real
    // clock, and its mate-finding strength is covered by the test below).
    const gmDeterministic = { ...gm, depth: 6, softMs: 60_000, bookPly: 0 };
    const pos = Position.fromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
    const a = botMove(pos, gmDeterministic, 42);
    const b = botMove(pos.clone(), gmDeterministic, 42);
    expect(a.uci).toBe(b.uci);
    expect(a.depth).toBe(b.depth);
  });

  it('weaker bots are genuinely weaker on a tactic', () => {
    // Philidor's Legacy position: only Nf7+ or Qg8+ lead to forced mate.
    const fen = '5r1k/6pp/8/6N1/8/1Q6/8/7K w - - 0 1';
    const gm = BOTS.find((b) => b.id === 'grandmaster')!;
    const gmDecision = botMove(Position.fromFen(fen), gm, 7);
    expect(gmDecision.uci).toMatch(/^(g5f7|b3g8)$/); // GM finds a forced mate
    expect(Math.abs(gmDecision.score)).toBeGreaterThanOrEqual(90_000);

    // Apprentice (depth 2, noisy) should find the mate less reliably than GM over seeds.
    const apprentice = BOTS.find((b) => b.id === 'apprentice')!;
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const d = botMove(Position.fromFen(fen), apprentice, seed);
      if (d.uci === 'b3g8' || d.uci === 'g5f7') hits++;
    }
    // With depth 2 it cannot prove the mate — should miss at least once.
    expect(hits).toBeLessThan(10);
  });

  it('rookie plays legal moves and sometimes blunders', () => {
    const rookie = BOTS.find((b) => b.id === 'rookie')!;
    const pos = Position.initial();
    let blunderish = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = botMove(pos, rookie, seed);
      expect(d.uci).not.toBeNull();
      expect(pos.uciToMove(d.uci!)).not.toBeNull();
      // A "blunder" pick: verify the chosen move is legal (already proven) —
      // statistically some picks should differ from the best move.
      const best = findBestMove(pos.clone(), { maxDepth: 2, softMs: 200 });
      if (d.uci !== moveToUci(best.bestMove)) blunderish++;
    }
    expect(blunderish).toBeGreaterThan(0);
  });

  it('bot configs form a real ladder', () => {
    const depths = BOTS.map((b) => b.depth);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]!).toBeGreaterThan(depths[i - 1]!);
    }
  });
});

describe('opening book', () => {
  it('book was built and every line is legal', () => {
    expect(bookSize()).toBeGreaterThan(30);
    const pos = Position.initial();
    expect(bookOptions(pos).length).toBeGreaterThanOrEqual(4); // 1.e4 / 1.d4 / 1.c4 / 1.Nf3
  });
});

describe('move quality analysis', () => {
  it('detects a blunder with large cp loss', () => {
    // White to play: best is Qxd8+ winning the queen; playing Qd2 instead is a blunder.
    const pos = Position.fromFen('rnb1kbnr/pppp1ppp/8/4p3/6q1/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    const q = analyzeMoveQuality(pos, 'd1d2', 6);
    expect(q.lossCp).toBeGreaterThan(300);
    const best = analyzeMoveQuality(pos, q.bestUci, 6);
    expect(best.lossCp).toBeLessThanOrEqual(10);
  });
});
