import { describe, expect, it } from 'vitest';
import { Position } from '../src/chess/position';
import { decodeMove, encodeMoveObj, moveToUci } from '../src/chess/constants';
import { moveToSan, sanToMove } from '../src/chess/san';
import { exportPgn, parsePgn, replayPgn } from '../src/chess/pgn';

describe('SAN', () => {
  it.each(['c8=Q+', 'c8Q+', 'c8=R+!', 'c8=N', 'c8=B'])('reads promotion %s', (san) => {
    const p = Position.fromFen('7k/2P5/5K2/8/8/8/8/8 w - - 0 1');
    const m = sanToMove(p, san);
    expect(m).not.toBeNull();
    expect(moveToUci(encodeMoveObj(m!))).toBe(`c7c8${san.includes('R') ? 'r' : san.includes('N') ? 'n' : san.includes('B') ? 'b' : 'q'}`);
  });
  it('accepts en-passant annotation without mutating the source position', () => {
    const p = Position.fromFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), fen = p.fen();
    expect(sanToMove(p, 'exd6 e.p.')).not.toBeNull(); expect(p.fen()).toBe(fen); expect(p.moves).toEqual([]);
  });
});

describe('PGN', () => {
  it('reads compact move numbers, arbitrary nested variations, comments and NAGs', () => {
    const p = parsePgn('[Event "Brackets ] in a header"]\n\n1.e4 (1.d4 (1.c4 (1.Nf3))) e5 { text ] } 2.Nf3 $1 Nc6 ; ] comment\n3.Bb5 a6 1-0');
    expect(p.moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(p.result).toBe('1-0'); expect(replayPgn(p).position.ply).toBe(6);
  });
  it('round-trips escaped headers and never emits header injection', () => {
    const p = Position.initial(); p.playUci('e2e4');
    const name = 'Player "quoted" \\ name\n[Result "0-1"]';
    const text = exportPgn(p, { White: name }, '*');
    const parsed = parsePgn(text);
    expect(parsed.headers.White).toBe(name.replace(/\s*\n\s*/g, ' '));
    expect(parsed.result).toBe('*'); expect(parsed.moves).toEqual(['e4']);
    expect(parsed.headers.Result).toBe('*');
  });
  it('exports black-to-move custom roots using the original move number', () => {
    const root = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 19';
    const p = Position.fromFen(root); p.playUci('e8g8'); p.playUci('e1c1');
    const text = exportPgn(p, {}, '1/2-1/2');
    expect(text).toContain('19... O-O 20. O-O-O 1/2-1/2');
    const replay = replayPgn(parsePgn(text)); expect(replay.startFen).toBe(root); expect(replay.position.fen()).toBe(p.fen());
  });
  it.each(['koth', 'three-check'] as const)('preserves the %s rule variant', (variant) => {
    const p = Position.initial(); p.applyVariant(variant); p.playUci('e2e4');
    expect(replayPgn(parsePgn(exportPgn(p, {}, '*'))).position.variant).toBe(variant);
  });
  it('does not silently combine or truncate a multi-game file', () => {
    expect(() => parsePgn('[Event "One"]\n1.e4 e5 1-0\n\n[Event "Two"]\n1.d4 d5 0-1')).toThrow(/one game|single game/i);
  });
  it.each(['1. e4 (1. d4', '1. e4 {unfinished', '1. e4 ) e5', '[Event "unfinished] 1.e4'])('rejects truncated PGN %s', (text) => {
    expect(() => parsePgn(text)).toThrow();
  });
  it('uses movetext results and rejects conflicting header results', () => {
    expect(parsePgn('1. e4 e5 0-1').result).toBe('0-1');
    expect(() => parsePgn('[Result "1-0"]\n1. e4 e5 0-1')).toThrow(/result/i);
  });
  it('round-trips the SAN of each played move', () => {
    const p = Position.initial();
    for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6']) {
      const m = p.uciToMove(uci)!; const san = moveToSan(p, decodeMove(m));
      expect(moveToUci(encodeMoveObj(sanToMove(p, san)!))).toBe(uci); p.makeMove(m);
    }
    expect(replayPgn(parsePgn(exportPgn(p, {}, '*'))).position.fen()).toBe(p.fen());
  });
});
