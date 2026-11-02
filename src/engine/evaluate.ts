/**
 * Evaluation function — one board scan per call, no allocations, plus a
 * direct-mapped eval cache keyed by the (verified) Zobrist hash since search
 * trees revisit the same positions constantly.
 *
 * Profiles:
 *   - 'basic': material + tapered PST + tempo (incremental score).
 *   - 'full':  adds pawn structure, passed pawns, bishop pair, rook files,
 *              mobility and king safety.
 *
 * Scores are centipawns from the side-to-move's perspective (negamax).
 */
import { BISHOP_DIRS, BLACK, Color, KING_OFFSETS, KNIGHT_OFFSETS, PAWN, QUEEN_DIRS, ROOK_DIRS, WHITE, colorOf, typeOf } from '../chess/constants';
import type { Position } from '../chess/position';

export type EvalProfile = 'basic' | 'full';

const PASSED_MG = [0, 5, 10, 20, 35, 60, 100, 0];
const PASSED_EG = [0, 10, 20, 40, 70, 120, 180, 0];
const ISOLATED = -14;
const DOUBLED = -12;
const BISHOP_PAIR = 32;
const ROOK_OPEN = 22;
const ROOK_SEMI = 10;
const TEMPO = 12;
const KING_ZONE_PENALTY = [0, 0, 5, 14, 27, 48, 77, 112];

// Scratch (single-threaded per Searcher call chain).
const MAX_PIECES = 16;
const pawnSqs = [new Int32Array(MAX_PIECES), new Int32Array(MAX_PIECES)];
const knightSqs = [new Int32Array(MAX_PIECES), new Int32Array(MAX_PIECES)];
const sliderSqs = [new Int32Array(MAX_PIECES), new Int32Array(MAX_PIECES)]; // bishops, rooks, queens
const sliderInfo = [new Int8Array(MAX_PIECES), new Int8Array(MAX_PIECES)];  // piece type per slider
const counts = { pawn: new Int8Array(2), knight: new Int8Array(2), slider: new Int8Array(2), bishop: new Int8Array(2) };
const pawnFiles = [new Int8Array(8), new Int8Array(8)];
const frontier = [new Int8Array(8), new Int8Array(8)]; // nearest enemy pawn rank per file
const zoneMask = new Uint8Array(128);

// Direct-mapped eval cache.
const EC_BITS = 16;
const EC_SIZE = 1 << EC_BITS;
const EC_MASK = EC_SIZE - 1;
const ecLo = new Int32Array(EC_SIZE);
const ecHi = new Int32Array(EC_SIZE);
const ecVal = new Int32Array(EC_SIZE);
const ecSeen = new Uint8Array(EC_SIZE); // entry occupied

export function clearEvalCache(): void {
  ecSeen.fill(0);
}

/** Phase: 24 (opening) → 0 (bare kings). */
export function gamePhase(pos: Position): number {
  let npm = 0;
  const w = [0, 0, 1, 1, 2, 4];
  for (let t = 2; t <= 5; t++) {
    npm += pos.counts[t]! * w[t]!;
    npm += pos.counts[t + 8]! * w[t]!;
  }
  return Math.max(0, Math.min(24, npm));
}

/** Fast path: incremental material + PST + tempo. */
export function evaluateBasic(pos: Position): number {
  const phase = gamePhase(pos);
  const stm = pos.stm;
  const mg = pos.pstScore[0][stm] - pos.pstScore[0][stm ^ 1];
  const eg = pos.pstScore[1][stm] - pos.pstScore[1][stm ^ 1];
  return ((mg * phase + eg * (24 - phase)) / 24 + TEMPO) | 0;
}

/** Full evaluation, side-to-move perspective, cached. */
export function evaluateFull(pos: Position): number {
  const idx = pos.hash.lo & EC_MASK;
  if (ecSeen[idx] && ecLo[idx] === pos.hash.lo && ecHi[idx] === pos.hash.hi) {
    const v = ecVal[idx]!;
    return pos.stm === WHITE ? v : -v;
  }
  const phase = gamePhase(pos);
  const white = evalSide(pos, WHITE, phase);
  const black = evalSide(pos, BLACK, phase);
  let score = white - black;
  const mg = pos.pstScore[0][WHITE] - pos.pstScore[0][BLACK];
  const eg = pos.pstScore[1][WHITE] - pos.pstScore[1][BLACK];
  score += (mg * phase + eg * (24 - phase)) / 24;
  score += TEMPO;
  const whitePov = score | 0;
  ecSeen[idx] = 1;
  ecLo[idx] = pos.hash.lo;
  ecHi[idx] = pos.hash.hi;
  ecVal[idx] = whitePov;
  return pos.stm === BLACK ? -whitePov : whitePov;
}function evalSide(pos: Position, color: Color, phase: number): number {
  const b = pos.board;
  const enemy = color ^ 1;
  counts.pawn[0] = counts.pawn[1] = 0;
  counts.knight[0] = counts.knight[1] = 0;
  counts.slider[0] = counts.slider[1] = 0;
  counts.bishop[0] = counts.bishop[1] = 0;
  pawnFiles[0].fill(0);
  pawnFiles[1].fill(0);
  frontier[0].fill(-1); // frontier[c][f] = nearest enemy pawn rank from c's view
  frontier[1].fill(-1);

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = b[sq]!;
    if (!piece) continue;
    const c = colorOf(piece);
    const t = typeOf(piece);
    const f = sq & 7;
    const r = sq >> 4;
    switch (t) {
      case PAWN: {
        pawnSqs[c]![counts.pawn[c]!] = sq;
        counts.pawn[c]!++;
        pawnFiles[c]![f]!++;
        // frontier from the *other* color's perspective
        const fo = frontier[enemy]!;
        if (enemy === WHITE ? fo[f]! < r : fo[f]! === -1 || fo[f]! > r) fo[f] = r;
        break;
      }
      case 2:
        knightSqs[c]![counts.knight[c]!] = sq;
        counts.knight[c]!++;
        break;
      case 3:
      case 4:
      case 5:
        sliderSqs[c]![counts.slider[c]!] = sq;
        sliderInfo[c]![counts.slider[c]!] = t;
        counts.slider[c]!++;
        if (t === 3) counts.bishop[c]!++;
        break;
      default:
        break;
    }
  }

  let score = 0;
  const ownFiles = pawnFiles[color]!;
  const ownFrontier = frontier[color]!;
  for (let f = 0; f < 8; f++) {
    const own = ownFiles[f]!;
    if (!own) continue;
    if (own > 1) score += DOUBLED * (own - 1);
    if ((f === 0 || !ownFiles[f - 1]!) && (f === 7 || !ownFiles[f + 1]!)) score += ISOLATED * own;
  }
  for (let i = 0; i < counts.pawn[color]!; i++) {
    const sq = pawnSqs[color]![i]!;
    const file = sq & 7;
    const rank = sq >> 4;
    let passed = true;
    for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
      const fr = ownFrontier[f]!;
      if (fr !== -1 && (color === WHITE ? fr > rank : fr < rank)) {
        passed = false;
        break;
      }
    }
    if (passed) {
      const relRank = color === WHITE ? rank : 7 - rank;
      score += (PASSED_MG[relRank]! * phase + PASSED_EG[relRank]! * (24 - phase)) / 24 | 0;
    }
  }
  if (counts.bishop[color]! >= 2) score += BISHOP_PAIR;
  for (let i = 0; i < counts.slider[color]!; i++) {
    if (sliderInfo[color]![i]! === 4) {
      const file = sliderSqs[color]![i]! & 7;
      if (!ownFiles[file]!) score += ownFrontier[file]! !== -1 ? ROOK_SEMI : ROOK_OPEN;
    }
  }
  if (phase > 6) {
    const kSq = pos.kingSquare(color);
    const kf = kSq & 7;
    let shield = 0;
    for (let f = Math.max(0, kf - 1); f <= Math.min(7, kf + 1); f++) {
      if (ownFiles[f]!) shield += 8;
    }
    score += Math.min(24, shield);

    // Enemy attack units in our king zone.
    zoneMask.fill(0);
    zoneMask[kSq] = 1;
    for (let i = 0; i < 8; i++) {
      const t = kSq + KING_OFFSETS[i]!;
      if ((t & 0x88) === 0) zoneMask[t] = 1;
    }
    let units = 0;
    for (let i = 0; i < counts.knight[enemy]!; i++) {
      const sq = knightSqs[enemy]![i]!;
      for (let j = 0; j < 8; j++) {
        const t = sq + KNIGHT_OFFSETS[j]!;
        if ((t & 0x88) === 0 && zoneMask[t]) {
          units += 2;
          break;
        }
      }
    }
    for (let i = 0; i < counts.slider[enemy]!; i++) {
      const sq = sliderSqs[enemy]![i]!;
      const t = sliderInfo[enemy]![i]!;
      const dirs = t === 3 ? BISHOP_DIRS : t === 4 ? ROOK_DIRS : QUEEN_DIRS;
      const w = t === 3 ? 2 : t === 4 ? 3 : 5;
      for (let j = 0; j < dirs.length; j++) {
        const d = dirs[j]!;
        let target = sq + d;
        while ((target & 0x88) === 0) {
          if (zoneMask[target]) {
            units += w;
            break;
          }
          if (b[target]) break;
          target += d;
        }
      }
    }
    score -= KING_ZONE_PENALTY[Math.min(7, units >> 1)]!;
  }

  return score;
}
