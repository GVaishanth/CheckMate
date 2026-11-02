/**
 * Core constants and bit-level helpers for the 0x88 board representation.
 *
 * Square index: sq = rank * 16 + file  (rank 0 = rank '1', file 0 = file 'a').
 * A square is on the board iff (sq & 0x88) === 0. The gap rows/files make
 * off-board detection a single bitwise AND, which keeps move generation fast.
 */

export const WHITE = 0 as const;
export const BLACK = 1 as const;
export type Color = typeof WHITE | typeof BLACK;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;

/** Piece codes: white = type (1..6), black = type | 8 (9..14). */
export const makePiece = (type: PieceType, color: Color): number => type | (color << 3);
export const typeOf = (piece: number): PieceType => (piece & 7) as PieceType;
export const colorOf = (piece: number): Color => (piece >> 3) as Color;

// Numeric piece codes for hot paths (avoid recomputing makePiece).
export const P_W = 1, N_W = 2, B_W = 3, R_W = 4, Q_W = 5, K_W = 6;
export const P_B = 9, N_B = 10, B_B = 11, R_B = 12, Q_B = 13, K_B = 14;

export const pieceName = (piece: number): string =>
  piece === 0 ? '' : (['', 'Pawn', 'Knight', 'Bishop', 'Rook', 'Queen', 'King'] as const)[piece & 7];

export const PIECE_LETTER: Record<number, string> = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };

// Movement offsets (0x88).
export const KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33] as const;
export const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17] as const;
export const BISHOP_DIRS = [-17, -15, 15, 17] as const;
export const ROOK_DIRS = [-16, -1, 1, 16] as const;
export const QUEEN_DIRS = [-17, -16, -15, -1, 1, 15, 16, 17] as const;

// Notable squares.
export const A1 = 0x00, B1 = 0x01, C1 = 0x02, D1 = 0x03, E1 = 0x04, F1 = 0x05, G1 = 0x06, H1 = 0x07;
export const A8 = 0x70, B8 = 0x71, C8 = 0x72, D8 = 0x73, E8 = 0x74, F8 = 0x75, G8 = 0x76, H8 = 0x77;

// Castling right bits.
export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;
export const CASTLE_ALL = 15;

export const FILES = 'abcdefgh';
export const RANKS = '12345678';

export const onBoard = (sq: number): boolean => (sq & 0x88) === 0;
export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 4;
export const squareAt = (file: number, rank: number): number => (rank << 4) | file;

export const algebraic = (sq: number): string => FILES[fileOf(sq)] + RANKS[rankOf(sq)];

export function fromAlgebraic(s: string): number {
  const file = FILES.indexOf(s[0] ?? '');
  const rank = RANKS.indexOf(s[1] ?? '');
  if (file < 0 || rank < 0) throw new Error(`Invalid square "${s}"`);
  return squareAt(file, rank);
}

/** Mirrors a square vertically (used to mirror positions for puzzle variants). */
export const mirrorSquare = (sq: number): number => sq ^ 0x70;
// Move encoding: a move is a single integer.
//   bits 0..6   from square
//   bits 7..13  to square
//   bits 14..16 promotion piece type (0 = none)
//   bits 17..19 special flag

export const FLAG_NORMAL = 0;
export const FLAG_EN_PASSANT = 1;
export const FLAG_CASTLE_K = 2;
export const FLAG_CASTLE_Q = 3;
export const FLAG_DOUBLE = 4;

export const encodeMove = (from: number, to: number, promo = 0, flag = FLAG_NORMAL): number =>
  from | (to << 7) | (promo << 14) | (flag << 17);

export const moveFrom = (m: number): number => m & 0x7f;
export const moveTo = (m: number): number => (m >> 7) & 0x7f;
export const movePromo = (m: number): number => (m >> 14) & 7;
export const moveFlag = (m: number): number => (m >> 17) & 7;

/** High-level move object used at the UI boundary. */
export interface Move {
  from: number;
  to: number;
  promo: PieceType | null;
  flag: number;
}

export const decodeMove = (m: number): Move => ({
  from: moveFrom(m),
  to: moveTo(m),
  promo: (movePromo(m) || null) as PieceType | null,
  flag: moveFlag(m),
});

export const encodeMoveObj = (mv: Move): number =>
  encodeMove(mv.from, mv.to, mv.promo ?? 0, mv.flag);

/** UCI-style string, e.g. "e2e4" / "e7e8q" — used for worker + storage serialization. */
export const moveToUci = (m: number): string => {
  const promo = movePromo(m);
  return algebraic(moveFrom(m)) + algebraic(moveTo(m)) + (promo ? PIECE_LETTER[promo].toLowerCase() : '');
};

export function uciToMoveParts(uci: string): { from: number; to: number; promo: PieceType | null } {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error(`Malformed move "${uci}"`);
  return {
    from: fromAlgebraic(uci.slice(0, 2)),
    to: fromAlgebraic(uci.slice(2, 4)),
    promo: (uci.length === 5 ? ({ q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT } as Record<string, PieceType>)[uci[4]!] : null),
  };
}

/** Rule variants. Standard chess is the default everywhere. */
export type ChessVariant = 'standard' | 'three-check' | 'koth';

// Standard piece values (centipawns) shared by evaluation and UI.
export const PIECE_VALUE: Record<number, number> = { 0: 0, 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 20000 };
export const PIECE_VALUE_CP = [0, 100, 320, 330, 500, 900, 0] as const;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const other = (c: Color): Color => (c === WHITE ? BLACK : WHITE);
export const colorName = (c: Color): 'White' | 'Black' => (c === WHITE ? 'White' : 'Black');
