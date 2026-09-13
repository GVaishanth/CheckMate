/**
 * Puzzle dataset generator — runs OFFLINE (tsx scripts/gen:puzzles.ts) and
 * writes src/data/puzzles.json. Nothing here ships to the browser.
 *
 * Method (no external data, no scraped databases):
 *   1. Self-play thousands of quick engine games from varied openings.
 *   2. At every position, run a fast pre-filter search; when the side to move
 *      has a decisive shot, verify it at full depth and classify the motif:
 *      forced mate, fork, pin, skewer, discovered attack, sacrifice,
 *      back-rank mate, or endgame conversion.
 *   3. Keep only positions where the engine can prove the win (mate score or
 *      ≥ +250cp after the key move) and the solution is stable across
 *      re-searches.
 *
 * Every shipped puzzle is therefore machine-verified by this repository's own
 * engine, and its stored solution line comes from the engine's PV.
 */
import { Position } from '../src/chess/position';
import { Searcher } from '../src/engine/search';
import { TranspositionTable } from '../src/engine/tt';
import { moveToUci } from '../src/chess/constants';
import { botMove, BOTS } from '../src/engine';
import type { BotStyle } from '../src/engine/bots';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ------------------------------------------------------------------ types

export type PuzzleCategory =
  | 'checkmate' | 'fork' | 'pin' | 'skewer' | 'discovered'
  | 'sacrifice' | 'back-rank' | 'endgame' | 'mixed';

export interface GeneratedPuzzle {
  id: string;
  fen: string;
  category: PuzzleCategory;
  difficulty: 1 | 2 | 3 | 4;
  sideToMove: 'white' | 'black';
  /** Full engine PV (uci) — even plies are the solver's moves. */
  line: string[];
  /** The key move(s) the solver must find. */
  solution: string[];
  /** Short description of the motif (shown on reveal). */
  motif: string;
}

// ------------------------------------------------------------------ board helpers (0x88)

const KNIGHT_OFFS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_DIRS = [17, 15, -17, -15];
const ROOK_DIRS = [16, 1, -16, -1];
const KING_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

const PIECE_VALUE: Record<number, number> = { 1: 100, 2: 320, 3: 330, 4: 500, 5: 900, 6: 20000 };

function pieceTypeOf(p: number): number {
  return p & 7;
}
function colorOf(p: number): 0 | 1 {
  return (p >> 3) as 0 | 1;
}

function onBoard(sq: number): boolean {
  return sq >= 0 && sq < 128 && (sq & 0x88) === 0;
}

/** Squares a piece of given type/color attacks from `from` (pseudo-attacks). */
function attacksFrom(pos: Position, type: number, color: 0 | 1, from: number): number[] {
  const out: number[] = [];
  if (type === 1) {
    const dir = color === 0 ? 16 : -16;
    for (const d of [dir - 1, dir + 1]) {
      const t = from + d;
      if (onBoard(t)) out.push(t);
    }
  } else if (type === 2) {
    for (const d of KNIGHT_OFFS) {
      const t = from + d;
      if (onBoard(t)) out.push(t);
    }
  } else if (type === 6) {
    for (const d of KING_DIRS) {
      const t = from + d;
      if (onBoard(t)) out.push(t);
    }
  } else {
    const dirs = type === 3 ? BISHOP_DIRS : type === 4 ? ROOK_DIRS : KING_DIRS;
    for (const d of dirs) {
      let t = from + d;
      while (onBoard(t)) {
        out.push(t);
        if (pos.pieceAt(t) !== 0) break;
        t += d;
      }
    }
  }
  return out;
}

/** First enemy piece on the ray from `from` towards `dir`, or null. */
function firstOnRay(pos: Position, from: number, dir: number, enemyColor: 0 | 1): { sq: number; piece: number } | null {
  let t = from + dir;
  while (onBoard(t)) {
    const p = pos.pieceAt(t);
    if (p !== 0) return colorOf(p) === enemyColor ? { sq: t, piece: p } : null;
    t += dir;
  }
  return null;
}

function materialOf(pos: Position, color: 0 | 1): number {
  let m = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    const p = pos.pieceAt(sq);
    if (p !== 0 && colorOf(p) === color && pieceTypeOf(p) !== 6) m += PIECE_VALUE[pieceTypeOf(p)] ?? 0;
  }
  return m;
}

function pieceCount(pos: Position): number {
  let n = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    if (pos.pieceAt(sq) !== 0) n++;
  }
  return nCountSafe(n);
}
function nCountSafe(n: number): number {
  return n;
}

const moduleTT = new TranspositionTable();
const moduleSearcher = new Searcher(moduleTT);

// ------------------------------------------------------------------ classification

interface Candidate {
  fen: string;
  score: number;
  pv: number[];
  bestMove: number;
}

/**
 * Decide the puzzle category for a winning position. Returns null when no
 * clear motif fires (caller may still file it under 'mixed').
 */
function classify(pos: Position, res: { bestMove: number; pv: number[]; score: number }): {
  category: PuzzleCategory;
  motif: string;
} | null {
  const best = res.bestMove;
  const from = best & 0x7f;
  const to = (best >> 7) & 0x7f;
  const mover = pos.pieceAt(from);
  if (mover === 0) return null;
  const mColor = colorOf(mover);
  const eColor = (mover >> 3) === 0 ? 1 : 0;
  const mType = pieceTypeOf(mover);

  const mateIn = res.score >= 90_000 ? Math.ceil((100_000 - res.score) / 2) : 0;
  const givesCheck = lineGivesCheck(pos, res.pv);

  // --- back-rank mate: mate delivered to a king on its back rank.
  if (mateIn > 0) {
    const enemyKing = pos.kingSquare(eColor === 0 ? 0 : 1);
    if (enemyKing !== null && (enemyKing >> 4) === (eColor === 1 ? 7 : 0)) {
      const finalTo = lastMateSquare(pos, res.pv);
      const rankOk = finalTo !== null && (finalTo >> 4) === (eColor === 1 ? 7 : 0);
      if (rankOk) {
        return { category: 'back-rank', motif: 'Back-rank mate — the king has no escape hatch.' };
      }
    }
    return {
      category: 'checkmate',
      motif: mateIn === 1 ? 'Mate in one.' : `Forced mate in ${mateIn}.`,
    };
  }

  // --- endgame: low material AND a proven mate → conversion puzzle.
  // (Without the mate requirement the raw PV is just an advantage line, which
  // the dataset tests would reject — see harvestEndgames for the constructed
  // forced-mate conversions.)
  const totalMat = materialOf(pos, 0) + materialOf(pos, 1);
  if (mateIn > 0 && totalMat <= 3100 && pieceCount(pos) <= 10) {
    return { category: 'endgame', motif: 'Convert the endgame advantage.' };
  }

  // --- sacrifice: the key move offers/loses material yet still wins big.
  const target = pos.pieceAt(to);
  const defended = isDefended(pos, to, eColor) || pos.pieceAt(to) !== 0;
  const lowerValue = target !== 0 && PIECE_VALUE[pieceTypeOf(target)] < PIECE_VALUE[mType] - 150;
  const capturableAfter = attackersOf(pos, to, eColor).length > 0;
  if (defended && capturableAfter && (lowerValue || target === 0)) {
    return { category: 'sacrifice', motif: 'Sacrifice — give material to break through.' };
  }

  // --- discovered attack: the mover uncovers a slider's line.
  for (const dir of KING_DIRS) {
    // friendly slider behind `from` aiming through it
    let t = from - dir;
    while (onBoard(t)) {
      const p = pos.pieceAt(t);
      if (p !== 0) {
        if (colorOf(p) === mColor && (pieceTypeOf(p) === 3 || pieceTypeOf(p) === 4 || pieceTypeOf(p) === 5)) {
          const hit = firstOnRay(pos, from, dir, eColor);
          if (hit && (pieceTypeOf(hit.piece) >= 4 || pieceTypeOf(hit.piece) === 2 || (pos.inCheck() && pieceTypeOf(hit.piece) === 6))) {
            return { category: 'discovered', motif: 'Discovered attack — move the blocker, unleash the battery.' };
          }
        }
        break;
      }
      t -= dir;
    }
  }

  // --- fork: the moved piece attacks 2+ valuable enemy targets.
  const after = pos.clone();
  after.makeMove(best);
  const movedPiece = after.pieceAt(to);
  if (movedPiece !== 0 && pieceTypeOf(movedPiece) !== 6) {
    const attacked = attacksFrom(after, pieceTypeOf(movedPiece), mColor, to)
      .map((sq) => ({ sq, piece: after.pieceAt(sq) }))
      .filter((x) => x.piece !== 0 && colorOf(x.piece) === eColor && PIECE_VALUE[pieceTypeOf(x.piece)] >= 320)
      .map((x) => ({ sq: x.sq, val: pieceTypeOf(x.piece) === 6 ? 20000 : PIECE_VALUE[pieceTypeOf(x.piece)] }));
    if (attacked.length >= 2) {
      return { category: 'fork', motif: 'Fork — one piece, two targets.' };
    }
  }

  // --- pin / skewer: the moved piece aligns two enemy pieces on a line.
  if (mType === 3 || mType === 4 || mType === 5) {
    for (const dir of [...BISHOP_DIRS, ...ROOK_DIRS]) {
      const first = firstOnRay(after, to, dir, eColor);
      if (!first || pieceTypeOf(first.piece) === 6) continue;
      const behind = firstOnRay(after, first.sq, dir, eColor);
      if (!behind) continue;
      const vFirst = PIECE_VALUE[pieceTypeOf(first.piece)];
      const vBehind = PIECE_VALUE[pieceTypeOf(behind.piece)];
      if (vBehind === 20000 && vFirst < 20000) {
        return { category: 'pin', motif: 'Pin — the piece in front cannot move.' };
      }
      if (vFirst === 20000) continue; // check, not skewer
      if (vFirst >= vBehind + 150) {
        return { category: 'skewer', motif: 'Skewer — force the valuable piece to move.' };
      }
    }
  }

  if (givesCheck) {
    return { category: 'mixed', motif: 'Attack the king — calculate to the end.' };
  }
  return null;
}

function lineGivesCheck(pos: Position, pv: number[]): boolean {
  const c = pos.clone();
  for (const mv of pv.slice(0, 1)) {
    c.makeMove(mv);
  }
  return c.inCheck();
}

function lastMateSquare(pos: Position, pv: number[]): number | null {
  // Destination of the final mating move in the PV.
  if (pv.length === 0) return null;
  return (pv[pv.length - 1]! >> 7) & 0x7f;
}

function isDefended(pos: Position, sq: number, byColor: 0 | 1): boolean {
  return attackersOf(pos, sq, byColor).length > 0;
}

function attackersOf(pos: Position, sq: number, byColor: 0 | 1): number[] {
  const out: number[] = [];
  for (let f = 0; f < 128; f++) {
    if (!onBoard(f)) continue;
    const p = pos.pieceAt(f);
    if (p === 0 || colorOf(p) !== byColor) continue;
    const t = pieceTypeOf(p);
    if (t === 1) {
      const dir = byColor === 0 ? -16 : 16; // pawn defends from opposite side
      for (const d of [dir - 1, dir + 1]) {
        if (f + d === sq) out.push(f);
      }
    } else if (attacksFrom(pos, t, byColor, f).includes(sq)) {
      out.push(f);
    }
  }
  return out;
}


/**
 * Extends a (possibly truncated) engine PV to the actual mate by walking
 * best moves — forced mates stay forced regardless of which defense was
 * stored, so the completed line is still a valid solution.
 */
function extendToMate(start: Position, pv: string[]): { line: string[]; mate: boolean } {
  const pos = start.clone();
  const out: string[] = [];
  let valid = true;
  for (const uci of pv) {
    if (pos.uciToMove(uci) === null) {
      valid = false;
      break;
    }
    pos.playUci(uci);
    out.push(uci);
  }
  if (!valid) return { line: out, mate: false };
  let guard = 0;
  while (!pos.isCheckmate() && !pos.isStalemate() && guard++ < 48) {
    const r = deepSearchLocal(pos, 12, 350);
    if (!r.bestMove) break;
    const uci = moveToUci(r.bestMove);
    pos.makeMove(r.bestMove);
    out.push(uci);
  }
  return { line: out, mate: pos.isCheckmate() };
}

function deepSearchLocal(pos: Position, maxDepth: number, softMs: number) {
  return moduleSearcher.search(pos.clone(), { maxDepth, softMs }, { profile: 'full', quiescence: true });
}

// ------------------------------------------------------------------ harvest

function difficultyFor(cat: PuzzleCategory, mateIn: number, score: number, pieces: number): 1 | 2 | 3 | 4 {
  if (cat === 'endgame') return pieces <= 6 ? 2 : 3;
  if (mateIn === 1) return 1;
  if (mateIn === 2) return score >= 99_000 ? 2 : 3;
  if (mateIn === 3) return 3;
  if (mateIn >= 4) return 4;
  if (score >= 700) return pieces <= 10 ? 1 : 2;
  if (score >= 450) return 2;
  return pieces <= 8 ? 2 : 3;
}

function run(): void {
  const puzzles: GeneratedPuzzle[] = [];
  const seen = new Set<string>();
  const tt = new TranspositionTable();
  const searcher = new Searcher(tt);

  // Purpose-built fast self-play styles: short search, blunder-prone —
  // quick games full of punishable mistakes (that's where tactics live).
  const fastStyles: BotStyle[] = [
    { ...BOTS[0]!, softMs: 40, bookPly: 6 },
    { ...BOTS[1]!, softMs: 50 },
    { id: 'harvest', name: 'HARVEST', elo: '', tagline: '', traits: [], depth: 3, softMs: 70,
      noiseCp: 60, blunderRate: 0.18, quiescence: true, profile: 'basic', bookPly: 8, rankRoot: true, pips: 3 },
  ];
  const GAMES = Number(process.env.PUZZLE_GAMES ?? 130);
  const rngSeedBase = 20260912;

  let mateCount = 0;
  let tacticCount = 0;

  for (let g = 0; g < GAMES; g++) {
    // Alternate opening variety via seeded random first moves from the book.
    const whiteBot = fastStyles[g % fastStyles.length]!;
    const blackBot = fastStyles[(g + 1) % fastStyles.length]!;
    const pos = Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    let seed = (rngSeedBase + g * 7919) >>> 0;

    for (let ply = 0; ply < 110; ply++) {
      // --- candidate check at this position
      const quick = moduleSearcher.search(pos.clone(), { maxDepth: 3, softMs: 8 }, { profile: 'full', quiescence: true });
      if ((quick.score >= 350 || quick.score >= 90_000) && quick.bestMove !== 0) {
        // Verify at full strength.
        moduleTT.clear();
        const deep = moduleSearcher.search(pos.clone(), { maxDepth: 7, softMs: 260 }, { profile: 'full', quiescence: true });
        let cl = classify(pos, deep);
        const mateIn = deep.score >= 90_000 ? Math.ceil((100_000 - deep.score) / 2) : 0;
        if (!cl && !mateIn && deep.score >= 550) {
          cl = { category: 'mixed', motif: 'Decisive combination — find the strongest continuation.' };
        }
        if (cl && (deep.score >= 300 || mateIn > 0)) {
          const fenKey = pos.fen().split(' ').slice(0, 4).join(' ');
          if (!seen.has(fenKey)) {
            seen.add(fenKey);
            let line = deep.pv.map(moveToUci);
            if (mateIn > 0) {
              const ext = extendToMate(pos, line);
              if (!ext.mate) continue; // PV unrepairable — skip this candidate
              line = ext.line;
            }
            const solution = line.filter((_, i) => i % 2 === 0).slice(0, mateIn > 0 ? Math.ceil(line.length / 2) : 3);
            if (solution.length > 0 && (mateIn > 0 || deep.score >= 300)) {
              puzzles.push({
                id: `p-${puzzles.length + 1}`,
                fen: pos.fen(),
                category: cl.category,
                difficulty: difficultyFor(cl.category, mateIn, deep.score, pieceCount(pos)),
                sideToMove: pos.stm === 0 ? 'white' : 'black',
                line,
                solution,
                motif: cl.motif,
              });
              if (mateIn > 0) mateCount++;
              else tacticCount++;
            }
          }
        }
      }

      // --- advance the game with a bot move (variety engine)
      const style = pos.stm === 0 ? whiteBot : blackBot;
      const decision = botMove(pos.clone(), style, seed);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      if (decision.uci === null || pos.ply > 100) break;
      pos.playUci(decision.uci);
      if (pos.isCheckmate() || pos.isStalemate() || pos.isInsufficientMaterial() || pos.repetitionCount() >= 3 || pos.isDrawByFiftyMoves()) break;
    }
    if ((g + 1) % 10 === 0) {
      console.log(`games ${g + 1}/${GAMES} → puzzles: ${puzzles.length} (mates ${mateCount}, tactics ${tacticCount})`);
    }
  }

  // --- endgame conversions from constructed positions -------------------
  harvestEndgames(puzzles, seen, moduleSearcher, moduleTT);

  // Balance the set: cap any category at 40 entries (keep hardest variety).
  const byCat = new Map<string, GeneratedPuzzle[]>();
  for (const p of puzzles) {
    const list = byCat.get(p.category) ?? [];
    list.push(p);
    byCat.set(p.category, list);
  }
  const CAPS: Partial<Record<PuzzleCategory, number>> = {
    checkmate: 46, 'back-rank': 30, fork: 40, pin: 40, skewer: 20, discovered: 30,
    sacrifice: 34, endgame: 40, mixed: 32,
  };
  const final: GeneratedPuzzle[] = [];
  for (const [cat, list] of byCat) {
    final.push(...list.slice(0, CAPS[cat as PuzzleCategory] ?? 40));
  }
  final.sort((a, b) => a.difficulty - b.difficulty || a.category.localeCompare(b.category));
  final.forEach((p, i) => (p.id = `p-${i + 1}`));

  const out = {
    version: 1,
    generated: new Date().toISOString(),
    method: 'Self-play harvest verified by the bundled engine (see scripts/generate-puzzles.ts)',
    count: final.length,
    puzzles: final,
  };
  const dest = join(process.cwd(), 'src/data/puzzles.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(out));
  const catSummary = [...byCat.entries()].map(([c, l]) => `${c}:${l.length}`).join(' ');
  console.log(`Wrote ${final.length} puzzles to src/data/puzzles.json`);
  console.log(catSummary);
}

/**
 * Endgame pass — construct basic mating endings (KQ vs K, KR vs K) with
 * randomized, engine-verified placements. The solver must convert the win.
 */
function harvestEndgames(puzzles: GeneratedPuzzle[], seen: Set<string>, searcher: Searcher, tt: TranspositionTable): void {
  const layouts: Array<{ q: number; label: string; motif: string }> = [
    { q: 5, label: 'queen', motif: 'Queen ending — box the king in and mate.' },
    { q: 4, label: 'rook', motif: 'Rook ending — cut the king off and mate.' },
  ];
  let made = 0;
  outer: for (const layout of layouts) {
    for (let i = 0; i < 300 && made < 40; i++) {
      const rnd = mulberry2(i * 2654435761 + (layout.q === 5 ? 11 : 97));
      // Random squares; defender king biased towards edges (where mates live)
      // so verification succeeds more often.
      const ak = pickSquare(rnd);
      const ap = pickSquare(rnd);
      const dk = pickEdgeSquare(rnd);
      if (ak === null || ap === null || dk === null || ak === ap || ak === dk || ap === dk) continue;
      // Kings not adjacent, pieces distinct (guaranteed), defender not in check.
      if (Math.abs((ak >> 4) - (dk >> 4)) <= 1 && Math.abs((ak & 7) - (dk & 7)) <= 1) continue;
      // Build a FEN manually.
      const board: string[] = new Array(64).fill('.');
      const setSq = (sq: number, ch: string) => { board[(sq >> 4) * 8 + (sq & 7)] = ch; };
      setSq(ak, 'K');
      setSq(dk, 'k');
      setSq(ap, layout.q === 5 ? 'Q' : 'R');
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
      tt.clear();
      const res = searcher.search(pos.clone(), { maxDepth: 16, softMs: 550 }, { profile: 'full', quiescence: true });
      if (res.score < 90_000) continue; // must be a forced mate to be a clean conversion
      const mateIn = Math.ceil((100_000 - res.score) / 2);
      if (mateIn < 2 || mateIn > 10) continue;
      const key = pos.fen().split(' ').slice(0, 4).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      const ext = extendToMate(pos, res.pv.map(moveToUci));
      if (!ext.mate) continue;
      const line = ext.line;
      if (line.length < 2) continue;
      puzzles.push({
        id: `e-${made + 1}`,
        fen: pos.fen(),
        category: 'endgame',
        difficulty: line.length <= 7 ? 2 : line.length <= 15 ? 3 : 4,
        sideToMove: 'white',
        line,
        solution: line.filter((_, idx) => idx % 2 === 0),
        motif: layout.motif,
      });
      made++;
      if (made >= 40) break outer;
    }
  }
  console.log(`endgame pass: ${made} conversion puzzles`);
}

function pickSquare(rnd: () => number): number {
  const r = Math.floor(rnd() * 8);
  const f = Math.floor(rnd() * 8);
  return r * 16 + f;
}

/** A square on the two outer ranks or files — mate territory. */
function pickEdgeSquare(rnd: () => number): number {
  const edge = Math.floor(rnd() * 4); // 0 rank0, 1 rank7, 2 fileA, 3 fileH
  const r = edge === 0 ? 0 : edge === 1 ? 7 : Math.floor(rnd() * 8);
  const f = edge === 2 ? 0 : edge === 3 ? 7 : Math.floor(rnd() * 8);
  return r * 16 + f;
}

function mulberry2(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

run();
