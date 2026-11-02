import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { START_FEN, encodeMoveObj, fromAlgebraic, moveToUci } from '../src/chess/constants';
import { moveToSan } from '../src/chess/san';
import { GameController } from '../src/game/GameController';
import { exportPgn } from '../src/chess/pgn';

const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 19';
const history = (p: Position) => p.moves.map(moveToUci);

describe('position state', () => {
  it('keeps history and last-move coordinates through speculative move generation', () => {
    const c = new GameController({ whiteName: 'White', blackName: 'Black' });
    c.applyUci('e2e4'); c.applyUci('c7c5');
    const p = c.position;
    expect(history(p)).toEqual(['e2e4', 'c7c5']);
    expect(c.lastMove).toEqual({ from: fromAlgebraic('c7'), to: fromAlgebraic('c5') });
    for (const m of p.getLegalMoves()) moveToSan(p, m);
    p.makeNull();
    const m = p.getLegalMoves()[0]!;
    p.makeMove(encodeMoveObj(m)); p.undoMove(); p.undoMove();
    expect(history(p)).toEqual(['e2e4', 'c7c5']);
    expect(exportPgn(p, {}, '*')).toContain('1. e4 c5 *');
    c.undoPlies(1);
    expect(history(p)).toEqual(['e2e4']);
  });

  it('clones history and undo state independently, including a custom root', () => {
    const p = Position.fromFen(CASTLE_FEN);
    p.playUci('e8g8');
    const q = p.clone();
    expect(q.startFen).toBe(CASTLE_FEN);
    expect(history(q)).toEqual(['e8g8']);
    expect(q.canUndo).toBe(true);
    q.undoMove();
    expect(q.fen()).toBe(CASTLE_FEN);
    expect(history(p)).toEqual(['e8g8']);
    expect(p.fen()).not.toBe(q.fen());
  });

  it('reloads a normalized root and clears history, counters and undo', () => {
    const p = Position.initial(); p.applyVariant('three-check'); p.playUci('e2e4');
    p.loadFen(CASTLE_FEN);
    expect(p.startFen).toBe(CASTLE_FEN);
    expect(p.moves).toEqual([]);
    expect(p.hashHistory).toHaveLength(2);
    expect(p.canUndo).toBe(false);
    expect(p.variant).toBe('three-check');
    expect(p.checksGiven).toEqual([0, 0]);
  });

  it('leaves the original state intact when a reload is invalid', () => {
    const p = Position.initial(); p.playUci('e2e4');
    const fen = p.fen(), hash = { ...p.hash };
    expect(() => p.loadFen('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow();
    expect(p.fen()).toBe(fen); expect(p.hash).toEqual(hash); expect(history(p)).toEqual(['e2e4']);
  });

  it.each(['e8g8', 'e8c8'])('keeps incremental scores correct after black castling %s', (uci) => {
    const p = Position.fromFen(CASTLE_FEN); p.playUci(uci);
    const rebuilt = Position.fromFen(p.fen());
    expect(p.pstScore).toEqual(rebuilt.pstScore);
    expect(p.hash).toEqual(rebuilt.hash);
    p.undoMove();
    expect(p.pstScore).toEqual(Position.fromFen(CASTLE_FEN).pstScore);
  });

  it('treats an extra undo as a harmless no-op', () => {
    const p = Position.initial(); p.undoMove(); p.playUci('e2e4'); p.undoMove(); p.undoMove();
    expect(p.fen()).toBe(START_FEN);
  });

  it('does not allow changing rule variants in the middle of a game', () => {
    const p = Position.initial(); p.playUci('e2e4');
    expect(() => p.applyVariant('koth')).toThrow();
  });
});

describe('FEN validation', () => {
  it.each([
    '4k3/8/8/8/8/8/4K3/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/4K3/P7 w - - 0 1',
    '4k3/8/8/8/8/8/4K3/8 w - - 0 0',
    '4k3/8/8/8/8/8/4K3/8 w - - 0 9007199254740992',
    '4k3/8/8/8/8/8/4K3/8 w - - 0 1 extra',
    '4k3/8/8/8/8/8/4K3/8 w KK - 0 1',
    '4k3/8/8/4P3/8/8/4K3/8 w - d6 0 1',
    '4k3/8/3n4/3pP3/8/8/4K3/8 w - d6 0 1',
    '4k3/8/8/8/3pP3/8/4K3/8 w - e3 0 1',
  ])('rejects malformed position %s', (fen) => expect(() => Position.fromFen(fen)).toThrow());

  it('only hashes an en-passant right if a legal capture exists', () => {
    const p = Position.fromFen('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const q = Position.fromFen('k3r3/8/8/3pP3/8/8/8/4K3 w - - 0 1');
    expect(p.hash).toEqual(q.hash);
    expect(p.ep).toBe(-1);
    expect(p.getLegalMoves().map((m) => moveToUci(encodeMoveObj(m)))).not.toContain('e5d6');
  });

  it('keeps a genuine en-passant capture and its material accounting', () => {
    const p = Position.fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const root = p.fen(); p.playUci('e5d6');
    expect(p.counts).toEqual(Position.fromFen(p.fen()).counts);
    p.undoMove(); expect(p.fen()).toBe(root);
  });

  it('normalizes uncapturable but otherwise valid FEN en-passant targets', () => {
    const p = Position.fromFen('4k3/8/8/3p4/8/8/4K3/8 w - d6 0 1');
    expect(p.ep).toBe(-1); expect(p.startFen).toBe(p.fen());
  });
});

describe('variant lifecycle', () => {
  it.each(['koth', 'three-check'] as const)('preserves %s across rematch', (variant) => {
    const c = new GameController({ whiteName: 'W', blackName: 'B', variant });
    c.applyUci('e2e4'); c.reset();
    expect(c.position.variant).toBe(variant);
    expect(c.position.checksGiven).toEqual([0, 0]);
  });

  it('does not declare a lone bishop dead in three-check', () => {
    const p = Position.fromFen('7k/8/8/8/8/8/B7/4K3 w - - 0 1');
    expect(p.isInsufficientMaterial()).toBe(true); p.applyVariant('three-check');
    expect(p.isInsufficientMaterial()).toBe(false);
  });

  it('recognizes a terminal starting position', () => {
    const c = new GameController({ whiteName: 'W', blackName: 'B', startFen: '7k/6Q1/5K2/8/8/8/8/8 b - - 0 1' });
    expect(c.end).toEqual({ winner: 'white', reason: 'checkmate' });
  });
});
