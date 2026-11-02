import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position } from '../src/chess/position';
import { BLACK, WHITE, START_FEN, fromAlgebraic } from '../src/chess/constants';
import { CapturedPieces } from '../src/components/CapturedPieces';
import { MoveList, moveRows } from '../src/components/MoveList';
import { DEFAULT_SETTINGS } from '../src/storage/settings';

describe('captured material', () => {
  it('tracks actual captures by the capturing side, not missing starting pieces', () => {
    const pos = Position.fromFen('7k/8/8/8/8/8/8/7K w - - 0 1');
    expect(pos.capturedBy(WHITE)).toEqual([]); expect(pos.capturedBy(BLACK)).toEqual([]);
  });
  it('keeps captures, undo and cloned histories consistent', () => {
    const pos = Position.fromFen(START_FEN); pos.playUciMoves(['e2e4', 'd7d5', 'e4d5', 'd8d5']);
    expect(pos.capturedBy(WHITE)).toEqual([9]); expect(pos.capturedBy(BLACK)).toEqual([1]);
    const clone = pos.clone(); pos.undoMove();
    expect(pos.capturedBy(BLACK)).toEqual([]); expect(clone.capturedBy(BLACK)).toEqual([1]);
    expect(pos.capturedBy(WHITE)).toEqual([9]);
  });
  it('counts en passant as a real capture', () => {
    const pos = Position.fromFen(START_FEN); pos.playUciMoves(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
    expect(pos.capturedBy(WHITE)).toEqual([9]); pos.undoMove(); expect(pos.capturedBy(WHITE)).toEqual([]);
  });
  it('does not pretend a promoted pawn was captured and records promoted pieces correctly', () => {
    const pos = Position.fromFen('1r5k/P7/8/8/8/8/8/7K w - - 0 1'); pos.playUci('a7a8q');
    expect(pos.capturedBy(BLACK)).toEqual([]); pos.playUci('b8a8'); expect(pos.capturedBy(BLACK)).toEqual([5]);
  });
  it('uses the captured piece colour in both display styles', () => {
    const pos = Position.fromFen(START_FEN); pos.playUciMoves(['e2e4', 'd7d5', 'e4d5']);
    const svg = renderToStaticMarkup(createElement(CapturedPieces, { position: pos, color: WHITE, settings: DEFAULT_SETTINGS }));
    const glyph = renderToStaticMarkup(createElement(CapturedPieces, { position: pos, color: WHITE, settings: { ...DEFAULT_SETTINGS, pieceStyle: 'glyph' } }));
    expect(svg).toContain('role="img"'); expect(svg).toContain('Captured by white: pawn.'); expect(glyph).toContain('captured-glyph b');
  });
  it('requires an explicit promotion piece when matching UI moves', () => {
    const pos = Position.fromFen('7k/1P6/8/8/8/8/8/7K w - - 0 1');
    expect(pos.findMove(fromAlgebraic('b7'), fromAlgebraic('b8'), null)).toBeNull();
    expect(pos.findMove(fromAlgebraic('b7'), fromAlgebraic('b8'), 2)?.promo).toBe(2);
  });
});

describe('move-list numbering and semantics', () => {
  it('numbers ordinary White-first games', () => {
    expect(moveRows(['e4', 'e5', 'Nf3'])).toEqual([{ number: 1, white: 'e4', black: 'e5', wPly: 1, bPly: 2 }, { number: 2, white: 'Nf3', wPly: 3 }]);
  });
  it('leaves the White cell empty at a Black-to-move root', () => {
    const fen = START_FEN.replace('w KQkq - 0 1', 'b KQkq - 0 17');
    expect(moveRows(['e5', 'Nf3', 'Nc6'], fen)).toEqual([{ number: 17, black: 'e5', bPly: 1 }, { number: 18, white: 'Nf3', wPly: 2, black: 'Nc6', bPly: 3 }]);
  });
  it('uses the actual fullmove field for White-first FENs', () => {
    expect(moveRows(['e4'], START_FEN.replace('0 1', '0 42'))[0].number).toBe(42);
  });
  it('does not claim an empty state is a table', () => {
    expect(renderToStaticMarkup(createElement(MoveList, { sans: [] }))).not.toContain('role="table"');
  });
  it('keeps replay buttons native and live notation noninteractive', () => {
    const live = renderToStaticMarkup(createElement(MoveList, { sans: ['e4'] }));
    const replay = renderToStaticMarkup(createElement(MoveList, { sans: ['e4'], onSelectPly: () => undefined, currentPly: 1 }));
    expect(live).not.toContain('<button'); expect(live).toContain('role="cell"');
    expect(replay).toContain('<button'); expect(replay).not.toContain('role="cell" class="movelist-move'); expect(replay).toContain('aria-current="step"');
  });
});
