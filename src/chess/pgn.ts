/** Single-game PGN import/export, with legal SAN replay. */
import { Color, WHITE, decodeMove, encodeMoveObj, START_FEN } from './constants';
import { Position } from './position';
import { moveToSan, sanToMove } from './san';

export interface PgnHeaders { [key: string]: string }
export interface ParsedPgn {
  headers: PgnHeaders;
  moves: string[];
  result: string | null;
}

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const escapeHeader = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');

export function exportPgn(position: Position, headers: PgnHeaders, result: string): string {
  const ending = RESULT.test(result) ? result : '*';
  const tags: PgnHeaders = { ...headers, Result: ending };
  delete tags.FEN; delete tags.SetUp; delete tags.Variant;
  if (position.startFen !== START_FEN) { tags.FEN = position.startFen; tags.SetUp = '1'; }
  if (position.variant !== 'standard') tags.Variant = position.variant === 'koth' ? 'King of the Hill' : 'Three-check';
  const replay = Position.fromFen(position.startFen);
  replay.applyVariant(position.variant);
  const tokens: string[] = [];
  position.moves.forEach((enc, i) => {
    if (replay.stm === WHITE) tokens.push(`${replay.fullmove}.`);
    else if (i === 0) tokens.push(`${replay.fullmove}...`);
    tokens.push(moveToSan(replay, decodeMove(enc)));
    replay.makeMove(enc);
  });
  tokens.push(ending);
  const lines = Object.entries(tags).filter(([k]) => /^[A-Za-z][A-Za-z0-9_]*$/.test(k))
    .map(([k, v]) => `[${k} "${escapeHeader(v)}"]`);
  lines.push('');
  let line = '';
  for (const token of tokens) {
    if (line && line.length + token.length + 1 > 79) { lines.push(line); line = ''; }
    line += `${line ? ' ' : ''}${token}`;
  }
  return [...lines, line, ''].join('\n');
}

export function parsePgn(text: string): ParsedPgn {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The PGN is empty.');
  if (text.length > 1_000_000) throw new Error('PGN exceeds the 1 MB limit.');
  const headers: PgnHeaders = Object.create(null) as PgnHeaders;
  const moves: string[] = [];
  let index = 0, depth = 0, token = '', result: string | null = null, bodyStarted = false;
  const flush = () => {
    let value = token; token = '';
    if (!value) return;
    value = value.replace(/^\d+\.{1,3}/, '');
    if (!value || value === '...' || /^[!?]+$/.test(value) || /^e\.p\.$/i.test(value)) return;
    if (result !== null) throw new Error('Import one game at a time; this file contains more than one game.');
    if (RESULT.test(value)) { result = value; return; }
    if (moves.length >= 20_000) throw new Error('PGN contains too many moves.');
    moves.push(value);
  };
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === '{') {
      if (!depth) flush();
      const end = text.indexOf('}', index + 1);
      if (end < 0) throw new Error('Unclosed PGN comment.');
      index = end + 1; continue;
    }
    if (ch === ';' || (ch === '%' && (index === 0 || text[index - 1] === '\n'))) {
      if (!depth) flush();
      const end = text.indexOf('\n', index + 1);
      index = end < 0 ? text.length : end + 1; continue;
    }
    if (ch === '(') { if (!depth) flush(); depth++; index++; continue; }
    if (ch === ')') {
      if (!depth) throw new Error('Unexpected closing PGN variation.');
      depth--; index++; continue;
    }
    if (depth) { index++; continue; }
    if (/\s|\uFEFF/.test(ch)) { flush(); index++; continue; }
    if (ch === '[') {
      flush();
      if (bodyStarted) throw new Error('Import one game at a time; this file contains more than one game.');
      const header = /^\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\["\\])*)"\s*\]/.exec(text.slice(index));
      if (!header) throw new Error('Malformed PGN header.');
      if (Object.prototype.hasOwnProperty.call(headers, header[1]!)) throw new Error('Duplicate PGN header; import one game at a time.');
      if (header[2]!.length > 2048) throw new Error('PGN header is too long.');
      headers[header[1]!] = header[2]!.replace(/\\(["\\])/g, '$1');
      index += header[0].length; continue;
    }
    bodyStarted = true;
    if (ch === '$') {
      flush(); const nag = /^\$\d+/.exec(text.slice(index));
      if (!nag) throw new Error('Malformed PGN annotation.');
      index += nag[0].length; continue;
    }
    token += ch;
    if (token.length > 128) throw new Error('Invalid PGN move token.');
    index++;
  }
  if (depth) throw new Error('Unclosed PGN variation.');
  flush();
  const tagResult = headers.Result;
  if (tagResult && !RESULT.test(tagResult)) throw new Error('Invalid PGN result.');
  if (result && tagResult && result !== tagResult) throw new Error('PGN header and movetext results disagree.');
  return { headers, moves, result: result ?? tagResult ?? null };
}

export function replayPgn(parsed: ParsedPgn): { position: Position; startFen: string } {
  const pos = Position.fromFen(parsed.headers.FEN ?? START_FEN);
  const variant = parsed.headers.Variant?.toLowerCase().replace(/[\s_-]/g, '');
  if (variant === 'threecheck' || variant === '3check') pos.applyVariant('three-check');
  else if (variant === 'kingofthehill' || variant === 'koth') pos.applyVariant('koth');
  else if (variant && variant !== 'standard' && variant !== 'chess') throw new Error('Unsupported PGN variant.');
  parsed.moves.forEach((san, i) => {
    if (pos.variantWinner() !== null) throw new Error('PGN continues after a variant win.');
    const mv = sanToMove(pos, san);
    if (!mv) throw new Error(`Illegal or unknown move "${san}" at ply ${i + 1}`);
    pos.makeMove(encodeMoveObj(mv));
  });
  return { position: pos, startFen: pos.startFen };
}

export const pgnResultFor = (winner: Color | null): string =>
  winner === null ? '1/2-1/2' : winner === WHITE ? '1-0' : '0-1';
