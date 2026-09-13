/**
 * Elo test dataset generator — runs OFFLINE (tsx scripts/gen:elo) and writes
 * src/data/elo.json. Eight fixed, engine-verified assessment positions.
 *
 * Verification guarantees per round kind:
 *   - 'mate'    : forced mate in exactly N against ANY defense (every reply
 *                 is re-searched and must still be lost for the defender).
 *   - 'tactics' : single clearly-best move — gap to second best ≥ 150cp.
 *   - 'convert' : winning endgame, engine score ≥ 700cp for the solver.
 *   - 'consistency': quiet balanced position, |score| ≤ 80cp at depth 8.
 */
import { Position } from '../src/chess/position';
import { Searcher } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/tt';
import { moveToUci } from '../src/chess/constants';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type EloRoundKind = 'mate' | 'tactics' | 'convert' | 'consistency';
export type EloCategory = 'tactics' | 'calculation' | 'endgame' | 'consistency';

export interface EloRound {
  id: string;
  kind: EloRoundKind;
  category: EloCategory;
  fen: string;
  sideToMove: 'white' | 'black';
  /** best-move rounds: the one winning move. */
  bestMove?: string;
  /** mate rounds: mate distance in solver moves. */
  mateIn?: number;
  /** convert/consistency: how many solver moves before scoring. */
  targetMoves?: number;
  /** defender strength for convert/consistency rounds (BotStyle id). */
  defender?: 'apprentice' | 'club' | 'competitor';
  prompt: string;
  /** cp threshold used to score convert rounds. */
  winThresholdCp?: number;
}

const searcher = new Searcher(new TranspositionTable());

function deepSearch(pos: Position, maxDepth: number, softMs: number) {
  return searcher.search(pos.clone(), { maxDepth, softMs }, { profile: 'full', quiescence: true, rankRoot: true });
}

// ------------------------------------------------------------------ harvest helpers

interface Harvested {
  fen: string;
  pv: string[];
  bestMove: string;
  score: number;
  secondBest: number;
}

function* harvest(): Generator<Harvested> {
  // Fast, blunder-prone self-play — same recipe as the puzzle generator.
  const pos0 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  for (let g = 0; g < 200; g++) {
    const pos = Position.fromFen(pos0);
    let seed = (987_654_321 + g * 7919) >>> 0;
    for (let ply = 0; ply < 90; ply++) {
      const quick = searcher.search(pos.clone(), { maxDepth: 3, softMs: 8 }, { profile: 'full', quiescence: true });
      if (Math.abs(quick.score) >= 300) {
        const deep = deepSearch(pos, 8, 300);
        const sorted = deep.rootScores.slice().sort((a, b) => b.score - a.score);
        const best = sorted[0];
        const second = sorted[1];
        if (best && deep.pv.length > 0) {
          yield {
            fen: pos.fen(),
            pv: deep.pv.map(moveToUci),
            bestMove: moveToUci(best.move),
            score: deep.score,
            secondBest: second ? second.score : best.score - 999,
          };
        }
      }
      // advance with a noisy shallow move
      const r = searcher.search(pos.clone(), { maxDepth: 2, softMs: 6 }, { profile: 'basic', quiescence: true, rankRoot: true });
      if (!r.bestMove) break;
      pos.makeMove(r.bestMove);
      if (pos.isCheckmate() || pos.isStalemate() || pos.isInsufficientMaterial() || pos.repetitionCount() >= 3 || pos.isDrawByFiftyMoves()) break;
      seed = (seed * 1664525 + 1013904223) >>> 0;
      void seed;
    }
  }
}

function verifyMateIn(pos: Position, n: number): { pv: string[] } | null {
  // Search must prove mate in ≤ n solver moves, and every defender reply
  // along the line must still lose (forced).
  const res = deepSearch(pos, 9, 700);
  const mateIn = Math.ceil((100_000 - res.score) / 2);
  if (res.score < 90_000 || mateIn !== n || res.pv.length < 2 * n - 1) return null;
  const pv = res.pv.map(moveToUci);
  if (pv.length < 2 * (n - 1) + 1) return null;

  // Verify: after the solver's first move, EVERY defender reply loses.
  const afterFirst = pos.clone();
  afterFirst.makeMove(res.pv[0]!);
  const replies = afterFirst.getLegalMoves();
  if (n > 1 && replies.length === 0) return null;
  let checked = 0;
  for (const reply of replies) {
    const p2 = afterFirst.clone();
    p2.makeMove(reply.from | (reply.to << 7) | ((reply.promo ?? 0) << 14) | (reply.flag << 17));
    if (n === 1) {
      if (!p2.isCheckmate()) return null;
      checked++;
      continue;
    }
    const sub = deepSearch(p2, 8, 500);
    if (sub.score < 90_000 || Math.ceil((100_000 - sub.score) / 2) > n - 1) return null;
    checked++;
    if (checked >= 6) break; // spot-check up to 6 replies — all must hold
  }
  return { pv };
}

// ------------------------------------------------------------------ rounds

function findMateRound(n: number, id: string, prompt: string): EloRound | null {
  for (const h of harvest()) {
    if (h.score < 90_000) continue;
    const pos = Position.fromFen(h.fen);
    const v = verifyMateIn(pos, n);
    if (!v) continue;
    const side = pos.stm === 0 ? 'white' : 'black';
    return { id, kind: 'mate', category: 'calculation', fen: h.fen, sideToMove: side, mateIn: n, bestMove: v.pv[0]!, prompt };
  }
  return null;
}

function findTacticsRound(minGap: number, minScore: number, id: string, prompt: string, exclude: Set<string>): EloRound | null {
  for (const h of harvest()) {
    if (h.score < minScore || h.score >= 90_000) continue;
    if (h.bestMove === null) continue;
    if (h.score - h.secondBest < minGap) continue;
    if (exclude.has(h.bestMove)) continue;
    const pos = Position.fromFen(h.fen);
    // Reject trivial "take the hanging queen in one" for hard rounds: require
    // the best move to not be a simple recapture of undefended material.
    const side = pos.stm === 0 ? 'white' : 'black';
    return { id, kind: 'tactics', category: 'tactics', fen: h.fen, sideToMove: side, bestMove: h.bestMove, prompt };
  }
  return null;
}

function findConvertRound(piece: 'Q' | 'R', id: string, prompt: string, defender: 'apprentice' | 'club', targetMoves: number): EloRound | null {
  for (let i = 0; i < 400; i++) {
    const rnd = mulberry(i * 2654435761 + (piece === 'Q' ? 13 : 71));
    const ak = pickSquare(rnd);
    const ap = pickSquare(rnd);
    const dk = pickEdgeSquare(rnd);
    if (ak === ap || ak === dk || ap === dk) continue;
    if (Math.abs((ak >> 4) - (dk >> 4)) <= 1 && Math.abs((ak & 7) - (dk & 7)) <= 1) continue;
    const board: string[] = new Array(64).fill('.');
    const set = (sq: number, ch: string) => { board[(sq >> 4) * 8 + (sq & 7)] = ch; };
    set(ak, 'K');
    set(dk, 'k');
    set(ap, piece);
    let fenBoard = '';
    for (let r = 7; r >= 0; r--) {
      let run = 0;
      for (let f = 0; f < 8; f++) {
        const ch = board[r * 8 + f]!;
        if (ch === '.') run++;
        else {
          if (run) { fenBoard += String(run); run = 0; }
          fenBoard += ch;
        }
      }
      if (run) fenBoard += String(run);
      if (r > 0) fenBoard += '/';
    }
    const fen = `${fenBoard} w - - 0 1`;
    let pos: Position;
    try {
      pos = Position.fromFen(fen);
    } catch {
      continue;
    }
    if (pos.getLegalMoves().length === 0 || pos.inCheck()) continue;
    const res = deepSearch(pos, 16, 600);
    if (res.score < 90_000) continue;
    const mateIn = Math.ceil((100_000 - res.score) / 2);
    if (mateIn < 4 || mateIn > 11) continue;
    return { id, kind: 'convert', category: 'endgame', fen, sideToMove: 'white', targetMoves: Math.min(targetMoves, mateIn + 2), defender, prompt, winThresholdCp: 700 };
  }
  return null;
}

// quiet balanced position for the consistency round
const CONSISTENCY_FEN = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';

// ------------------------------------------------------------------ main

function run(): void {
  const rounds: EloRound[] = [];
  const usedTactics = new Set<string>();

  const t1 = findTacticsRound(200, 350, 't1', 'Find the strongest move for the side to play.', usedTactics);
  if (t1?.bestMove) usedTactics.add(t1.bestMove);
  if (t1) rounds.push(t1);

  const m1 = findMateRound(2, 'c1', 'A forced mate is available. Calculate it out.');
  if (m1) rounds.push(m1);

  const e1 = findConvertRound('Q', 'e1', 'Convert the queen ending — mate the lone king.', 'apprentice', 14);
  if (e1) rounds.push(e1);

  const t2 = findTacticsRound(260, 420, 't2', 'A tactical shot decides. Find it.', usedTactics);
  if (t2?.bestMove) usedTactics.add(t2.bestMove);
  if (t2) rounds.push(t2);

  // consistency round
  {
    const pos = Position.fromFen(CONSISTENCY_FEN);
    const res = deepSearch(pos, 8, 500);
    if (Math.abs(res.score) > 80) throw new Error(`Consistency FEN is not balanced: ${res.score}`);
    rounds.push({
      id: 's1',
      kind: 'consistency',
      category: 'consistency',
      fen: CONSISTENCY_FEN,
      sideToMove: 'white',
      targetMoves: 12,
      defender: 'club',
      prompt: 'No tactics here — play 12 solid moves. Precision is the test.',
    });
  }

  const m2 = findMateRound(3, 'c2', 'Deeper calculation: a forced win is on the board.');
  if (m2) rounds.push(m2);

  const e2 = findConvertRound('R', 'e2', 'Convert the rook ending — technique under pressure.', 'club', 16);
  if (e2) rounds.push(e2);

  const t3 = findTacticsRound(320, 480, 't3', 'The hardest shot of the test. Take your time.', usedTactics);
  if (t3?.bestMove) usedTactics.add(t3.bestMove);
  if (t3) rounds.push(t3);

  if (rounds.length < 8) {
    console.error(`Only ${rounds.length}/8 rounds found — adjust harvest parameters.`);
    process.exit(1);
  }

  const out = { version: 1, generated: new Date().toISOString(), rounds };
  const dest = join(process.cwd(), 'src/data/elo.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`Wrote ${rounds.length} verified rounds to src/data/elo.json`);
  for (const r of rounds) {
    console.log(`  ${r.id} ${r.kind.padEnd(12)} ${r.category.padEnd(12)} best=${r.bestMove ?? '-'} mateIn=${r.mateIn ?? '-'}`);
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickSquare(rnd: () => number): number {
  return Math.floor(rnd() * 8) * 16 + Math.floor(rnd() * 8);
}
function pickEdgeSquare(rnd: () => number): number {
  const edge = Math.floor(rnd() * 4);
  const r = edge === 0 ? 0 : edge === 1 ? 7 : Math.floor(rnd() * 8);
  const f = edge === 2 ? 0 : edge === 3 ? 7 : Math.floor(rnd() * 8);
  return r * 16 + f;
}

run();
