/**
 * SAN (Standard Algebraic Notation) generation and parsing.
 */
import { Color, Move, PAWN, PIECE_LETTER, WHITE, colorOf, encodeMoveObj, typeOf } from './constants';
import type { Position } from './position';
import { FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_EN_PASSANT } from './constants';

/** SAN for a legal move in the current position (with +/# suffix). */
export function moveToSan(pos: Position, move: Move): string {
  const piece = pos.pieceAt(move.from);
  const type = typeOf(piece);
  const isCapture = move.flag === FLAG_EN_PASSANT || pos.pieceAt(move.to) !== 0;
  let san: string;

  if (move.flag === FLAG_CASTLE_K) san = 'O-O';
  else if (move.flag === FLAG_CASTLE_Q) san = 'O-O-O';
  else if (type === PAWN) {
    san = isCapture ? fileChar(move.from) + 'x' + squareName(move.to) : squareName(move.to);
    if (move.promo) san += '=' + PIECE_LETTER[move.promo];
  } else {
    let disambig = '';
    const rivals = pos
      .getLegalMoves()
      .filter((m) => m.to === move.to && m.from !== move.from && typeOf(pos.pieceAt(m.from)) === type);
    if (rivals.length > 0) {
      const sameFile = rivals.some((m) => fileChar(m.from) === fileChar(move.from));
      const sameRank = rivals.some((m) => rankChar(m.from) === rankChar(move.from));
      if (!sameFile) disambig = fileChar(move.from);
      else if (!sameRank) disambig = rankChar(move.from);
      else disambig = squareName(move.from);
    }
    san = PIECE_LETTER[type] + disambig + (isCapture ? 'x' : '') + squareName(move.to);
  }

  // Check / mate suffix.
  const encoded = encodeMoveObj(move);
  pos.makeMove(encoded);
  const check = pos.inCheck();
  if (check) san += pos.getLegalMoves().length === 0 ? '#' : '+';
  pos.undoMove();
  return san;
}

/** Parses SAN text into the matching legal move, or null. */
export function sanToMove(pos: Position, sanInput: string): Move | null {
  let san = sanInput.trim().replace(/[+#!?]+$/g, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  if (!san) return null;
  const promoMatch = san.match(/=([QRBN])$/);
  if (promoMatch) san = san.slice(0, -2);
  for (const m of pos.getLegalMoves()) {
    const candidate = moveToSan(pos, m).replace(/[+#]+$/g, '');
    if (candidate === san || candidate === sanInput.trim()) return m;
  }
  // Tolerate "exd5 e.p." style or missing '=' on promotions.
  if (promoMatch) {
    for (const m of pos.getLegalMoves()) {
      const candidate = moveToSan(pos, m).replace(/[+#]+$/g, '').replace(/=[QRBN]$/, promoMatch[1]!);
      if (candidate === san) return m;
    }
  }
  return null;
}

const fileChar = (sq: number): string => 'abcdefgh'[sq & 7]!;
const rankChar = (sq: number): string => '12345678'[sq >> 4]!;
const squareName = (sq: number): string => fileChar(sq) + rankChar(sq);

/** Describes a square for screen readers, e.g. "white knight on g1". */
export function describeMove(pos: Position, move: Move, san: string): string {
  const piece = pos.pieceAt(move.from);
  const color = colorOf(piece) === WHITE ? 'White' : 'Black';
  const names: Record<number, string> = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
  const dest = squareName(move.to);
  const verb = move.flag === FLAG_CASTLE_K || move.flag === FLAG_CASTLE_Q ? 'castles' : `to ${dest}`;
  return `${color} ${names[typeOf(piece)]} ${verb}. ${san}`;
}

export const movedColor = (pos: Position, move: Move): Color => colorOf(pos.pieceAt(move.from));
