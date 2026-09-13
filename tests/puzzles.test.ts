/**
 * Puzzle dataset integrity — every shipped puzzle must be replayable and its
 * stored solution must hold: mate puzzles end in checkmate, every line move
 * is legal, metadata is in range.
 */
import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { PUZZLES } from '../src/data/puzzles';

describe('puzzle dataset', () => {
  it('has a substantial number of puzzles', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(200);
  });

  it('covers every category and difficulty', () => {
    const cats = new Set(PUZZLES.map((p) => p.category));
    for (const c of ['checkmate', 'fork', 'pin', 'skewer', 'discovered', 'sacrifice', 'back-rank', 'endgame', 'mixed']) {
      expect(cats.has(c as never), `category ${c} missing`).toBe(true);
    }
    const diffs = new Set(PUZZLES.map((p) => p.difficulty));
    expect(diffs.has(1)).toBe(true);
    expect(diffs.has(4)).toBe(true);
  });

  it('has unique ids and positions', () => {
    const ids = new Set(PUZZLES.map((p) => p.id));
    expect(ids.size).toBe(PUZZLES.length);
    const fens = new Set(PUZZLES.map((p) => p.fen.split(' ').slice(0, 4).join(' ')));
    expect(fens.size).toBeGreaterThan(PUZZLES.length * 0.95); // near-unique
  });

  it('replays every solution line legally', () => {
    for (const p of PUZZLES) {
      const pos = Position.fromFen(p.fen);
      for (const uci of p.line) {
        const enc = pos.uciToMove(uci);
        expect(enc, `${p.id}: illegal line move ${uci}`).not.toBeNull();
        pos.makeMove(enc!);
      }
    }
  });

  it('mate puzzles terminate in checkmate', () => {
    const mates = PUZZLES.filter((p) => p.category === 'checkmate' || p.category === 'back-rank');
    expect(mates.length).toBeGreaterThan(20);
    for (const p of mates) {
      const pos = Position.fromFen(p.fen);
      for (const uci of p.line) pos.playUci(uci);
      expect(pos.isCheckmate(), `${p.id} (${p.category}) line does not end in mate`).toBe(true);
    }
  });

  it('solution moves are the even plies of the line', () => {
    for (const p of PUZZLES) {
      expect(p.solution.length).toBeGreaterThan(0);
      expect(p.solution.length).toBeLessThanOrEqual(Math.ceil(p.line.length / 2));
      for (let i = 0; i < p.solution.length; i++) {
        expect(p.solution[i]).toBe(p.line[i * 2]);
      }
    }
  });

  it('endgame puzzles are forced mates for the solver', () => {
    const endgames = PUZZLES.filter((p) => p.category === 'endgame');
    expect(endgames.length).toBeGreaterThan(20);
    for (const p of endgames) {
      const pos = Position.fromFen(p.fen);
      for (const uci of p.line) pos.playUci(uci);
      expect(pos.isCheckmate(), `${p.id} endgame line does not end in mate`).toBe(true);
    }
  });
});
