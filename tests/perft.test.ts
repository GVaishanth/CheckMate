/**
 * Perft (performance test) — counts leaf nodes at fixed depth.
 * The reference numbers are the standard values from the Chess Programming
 * Wiki. If every perft matches, move generation (including castling,
 * en passant, promotions and pin legality) is correct.
 */
import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';

function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const buf = new Int32Array(256);
  const n = pos.generateInto(buf);
  let nodes = 0;
  for (let i = 0; i < n; i++) {
    const m = buf[i]!;
    pos.makeMove(m);
    if (!pos.inCheck(pos.stm === 0 ? 1 : 0)) {
      // inCheck(color of the side that just moved)
      nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    }
    pos.undoMove();
  }
  return nodes;
}

// Safer variant: legality check via the mover's king.
function perftSafe(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const buf = new Int32Array(256);
  const n = pos.generateInto(buf);
  let nodes = 0;
  for (let i = 0; i < n; i++) {
    const m = buf[i]!;
    pos.makeMove(m);
    // The side that just moved is the opposite of stm.
    const mover = pos.stm === 0 ? 1 : 0;
    if (!pos.inCheck(mover)) {
      nodes += depth === 1 ? 1 : perftSafe(pos, depth - 1);
    }
    pos.undoMove();
  }
  return nodes;
}

const cases: Array<[string, string, number, number]> = [
  ['Initial', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1, 20],
  ['Initial', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2, 400],
  ['Initial', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 8902],
  ['Initial', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 1, 48],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 4, 4085603],
  ['Pos3 ep-pins', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['Pos3 ep-pins', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
  ['Pos4 promos', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333],
  ['Pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 4, 2103487],
  ['Pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3, 89890],
  ['Pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 4, 3894594],
];

describe('perft', () => {
  for (const [name, fen, depth, expected] of cases) {
    it(`${name} d${depth} = ${expected}`, () => {
      const pos = Position.fromFen(fen);
      const start = Date.now();
      const got = perftSafe(pos, depth);
      const ms = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`  ${name} d${depth}: ${got} nodes in ${ms}ms (${Math.round(got / Math.max(1, ms))}k nps)`);
      expect(got).toBe(expected);
    });
  }
});
