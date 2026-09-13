/**
 * Tiny opening book (~20 common lines, human-playable).
 *
 * Bots pick uniformly among book continuations for variety; weaker bots use
 * shorter/none. Book positions are keyed by FEN (first 4 fields).
 */
import { Position } from '../chess/position';
import { moveToUci } from '../chess/constants';

const LINES: string[][] = [
  // Italian Game
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3', 'd7d6', 'e1g1', 'e8g8'],
  // Ruy Lopez
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'],
  // Sicilian, Najdorf
  ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'],
  // Sicilian, Classical
  ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'd7d5'],
  // French, Winawer
  ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4', 'e4e5', 'c7c5'],
  // Caro-Kann, main
  ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5', 'e4g3', 'f5g6'],
  // Queen's Gambit Declined
  ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7', 'e2e3', 'e8g8'],
  // Slav
  ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4', 'a2a4', 'c8f5'],
  // King's Indian
  ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8', 'f1e2', 'e7e5'],
  // Nimzo-Indian
  ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8', 'f1d3', 'd7d5'],
  // English Opening
  ['c2c4', 'e7e5', 'b1c3', 'g8f6', 'g1f3', 'b8c6', 'g2g3', 'd7d5', 'c4d5', 'f6d5'],
  // Réti
  ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2', 'e7e6', 'e1g1', 'f8e7', 'd2d3', 'e8g8'],
  // London System
  ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6', 'e2e3', 'f8d6', 'f4g3', 'e8g8'],
  // Scotch
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6', 'b1c3', 'f8b4'],
  // Four Knights
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b1c3', 'g8f6', 'f1b5', 'f8b4', 'e1g1', 'e8g8'],
  // Pirc
  ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6', 'g1f3', 'f8g7', 'f1e2', 'e8g8'],
  // Scandinavian
  ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'd2d4', 'g8f6', 'g1f3', 'c7c6'],
  // Vienna
  ['e2e4', 'e7e5', 'b1c3', 'g8f6', 'f2f4', 'e5f4', 'g1f3', 'd7d5'],
  // Queen's Gambit Accepted
  ['d2d4', 'd7d5', 'c2c4', 'd5c4', 'g1f3', 'g8f6', 'e2e3', 'e7e6', 'f1c4', 'c7c5'],
  // Petrov
  ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3e5', 'd7d6', 'e5f3', 'f6e4', 'd1e2', 'd6d5'],
];

/** Map: normalized FEN key → candidate continuation UCIs. */
const book: Map<string, string[]> = new Map();

function fenKey(pos: Position): string {
  const f = pos.fen().split(' ');
  return `${f[0]} ${f[1]} ${f[2]} ${f[3]}`;
}

(function buildBook() {
  for (const line of LINES) {
    const pos = Position.initial();
    for (let i = 0; i < line.length; i++) {
      const key = fenKey(pos);
      const uci = line[i]!;
      const existing = book.get(key);
      if (!existing?.includes(uci)) book.set(key, [...(existing ?? []), uci]);
      try {
        pos.playUci(uci);
      } catch {
        throw new Error(`Opening book contains illegal move ${uci} (ply ${i + 1})`);
      }
    }
  }
})();

export interface BookHit {
  uci: string;
  alternatives: number;
}

/** Returns a random book continuation, or null when out of book. */
export function bookMove(pos: Position, rng: () => number, maxPly: number): BookHit | null {
  if (pos.ply >= maxPly) return null;
  const options = book.get(fenKey(pos));
  if (!options || options.length === 0) return null;
  const uci = options[Math.floor(rng() * options.length)]!;
  return { uci, alternatives: options.length };
}

/** All book continuations for a position (used by tests). */
export function bookOptions(pos: Position): string[] {
  return book.get(fenKey(pos)) ?? [];
}

export const bookSize = (): number => book.size;
export { moveToUci };
