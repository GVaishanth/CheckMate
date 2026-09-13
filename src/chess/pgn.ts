/**
 * PGN export and import (headers, movetext with wrapping; comments,
 * variations and NAGs are stripped when reading).
 */
import { Color, WHITE, decodeMove, encodeMoveObj } from './constants';
import { Position } from './position';
import { moveToSan, sanToMove } from './san';

export interface PgnHeaders {
  [key: string]: string;
}

export interface ParsedPgn {
  headers: PgnHeaders;
  moves: string[]; // SAN strings
  result: string | null;
}

const STANDARD_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Exports the moves of `position` (which carries its own start FEN + move list). */
export function exportPgn(position: Position, headers: PgnHeaders, result: string): string {
  const sans: string[] = [];
  const replay = Position.fromFen(position.startFen);
  for (const enc of position.moves) {
    sans.push(moveToSan(replay, decodeMove(enc)));
    replay.makeMove(enc);
  }

  const tokens: string[] = [];
  for (let i = 0; i < sans.length; i++) {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(sans[i]!);
  }
  if (result !== '*') tokens.push(result);

  const lines: string[] = [];
  for (const [k, v] of Object.entries(headers)) lines.push(`[${k} "${v}"]`);
  if (position.startFen !== STANDARD_START) {
    lines.push(`[FEN "${position.startFen}"]`, '[SetUp "1"]');
  }
  lines.push('');

  let line = '';
  for (const t of tokens) {
    if ((line + ' ' + t).length > 79) {
      lines.push(line);
      line = t;
    } else {
      line = line ? `${line} ${t}` : t;
    }
  }
  if (line) lines.push(line);
  lines.push('');
  return lines.join('\n');
}

export function parsePgn(text: string): ParsedPgn {
  const headers: PgnHeaders = {};
  const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) headers[m[1]!] = m[2]!;
  const headerBlockEnd = text.lastIndexOf(']') + 1;
  let body = text.slice(Math.max(0, headerBlockEnd));

  body = body
    .replace(/\{[^}]*\}/g, ' ') // comments
    .replace(/;[^\n]*/g, ' ') // line comments
    .replace(/\([^()]*\)/g, ' ') // variations (two passes handle nesting one deep)
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' '); // NAGs

  const tokens = body.split(/\s+/).filter(Boolean);
  const moves: string[] = [];
  let result: string | null = null;
  for (const tok of tokens) {
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) {
      result = tok;
      continue;
    }
    if (/^\d+\.+$/.test(tok)) continue; // "1." / "2..." move numbers
    if (/^\d+$/.test(tok)) continue; // stray numbers
    moves.push(tok);
  }
  return { headers, moves, result };
}

/** Validates a PGN against the rules; returns the final position or throws with a readable message. */
export function replayPgn(parsed: ParsedPgn): { position: Position; startFen: string } {
  const startFen = parsed.headers['FEN'] ?? STANDARD_START;
  const pos = Position.fromFen(startFen);
  parsed.moves.forEach((san, i) => {
    const mv = sanToMove(pos, san);
    if (!mv) throw new Error(`Illegal or unknown move "${san}" at move ${Math.floor(i / 2) + 1}`);
    pos.makeMove(encodeMoveObj(mv));
  });
  return { position: pos, startFen };
}

export const pgnResultFor = (winner: Color | null): string =>
  winner === null ? '1/2-1/2' : winner === WHITE ? '1-0' : '0-1';
