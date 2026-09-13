export type Mode = 'menu' | 'p2p' | 'local';

/** Shared helpers for the multiplayer modes. */
import { BoardAnimate } from '../../components/Board';
import { GameController } from '../../game/GameController';
import { PieceType } from '../../chess/constants';
import { StoredGame } from '../../storage/db';

export function outcomeOf(c: GameController): StoredGame['outcome'] {
  if (c.end?.winner === 'white') return { result: 'white' };
  if (c.end?.winner === 'black') return { result: 'black' };
  return {
    result: 'draw',
    reason: (c.end?.reason as 'stalemate' | 'agreement' | 'threefold' | 'fifty-move' | 'insufficient' | 'disconnect') ?? 'agreement',
  };
}

export function resultString(c: GameController): string {
  return c.end?.winner === 'white' ? '1-0' : c.end?.winner === 'black' ? '0-1' : '1/2-1/2';
}

export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function sqAlg(sq: number): string {
  return `${String.fromCharCode(97 + (sq & 7))}${(sq >> 4) + 1}`;
}

export function promoLetter(promo: PieceType | null): string {
  switch (promo) {
    case 2: return 'n';
    case 3: return 'b';
    case 4: return 'r';
    case 5:
    case 6: return 'q';
    default: return '';
  }
}

export function uciToAnim(uci: string, capture: boolean): BoardAnimate {
  const from = (uci.charCodeAt(0) - 97) + (Number(uci[1]) - 1) * 16;
  const to = (uci.charCodeAt(2) - 97) + (Number(uci[3]) - 1) * 16;
  return { from, to, capturedPiece: capture ? 1 : 0, capturedSquare: capture ? to : -1, promoted: uci.length === 5 };
}
