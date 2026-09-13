/**
 * Search: iterative deepening negamax with
 *   - alpha-beta pruning (PVS-style at the root)
 *   - transposition table (Zobrist-verified)
 *   - null-move pruning (guarded against zugzwang)
 *   - late move reductions
 *   - check extensions
 *   - killer moves + history heuristic + MVV-LVA ordering
 *   - quiescence search with delta pruning
 *
 * Weaker bots request `rankRoot`: every root move is searched with a full
 * window (no sibling cutoffs) so noise/blunder selection uses real scores.
 */
import { FLAG_EN_PASSANT, PAWN, PIECE_VALUE_CP, colorOf, moveFlag, moveFrom, movePromo, moveTo, other, typeOf } from '../chess/constants';
import { Position } from '../chess/position';
import { MATE_BOUND, MATE_SCORE, MoveScore, SearchLimits, SearchResult } from './search-types';
import { TranspositionTable, TT_ALPHA, TT_BETA, TT_EXACT } from './tt';
import { EvalProfile, evaluateBasic, evaluateFull } from './evaluate';

const INF = 1_000_000;
const MAX_PLY = 64;
const MAX_TOTAL_PLY = MAX_PLY + 32;

export class Searcher {
  private tt: TranspositionTable;
  private pos!: Position;
  private buffers: Int32Array[] = [];
  private scores: Float64Array[] = [];
  private killers = new Int32Array(MAX_PLY * 2);
  private history = new Int32Array(15 * 128);
  private nodes = 0;
  private startTime = 0;
  private deadline = Infinity;
  private stopped = false;
  private profile: EvalProfile = 'full';
  private useQuiescence = true;

  constructor(tt: TranspositionTable) {
    this.tt = tt;
    for (let i = 0; i < MAX_TOTAL_PLY + 2; i++) {
      this.buffers.push(new Int32Array(256));
      this.scores.push(new Float64Array(256));
    }
  }

  search(
    pos: Position,
    limits: SearchLimits,
    opts?: { profile?: EvalProfile; quiescence?: boolean; rankRoot?: boolean; onDepth?: (r: { depth: number; score: number; nodes: number; ms: number }) => void },
  ): SearchResult {
    this.pos = pos;
    this.profile = opts?.profile ?? 'full';
    this.useQuiescence = opts?.quiescence ?? true;
    this.nodes = 0;
    this.stopped = false;
    this.startTime = Date.now();
    this.deadline = limits.softMs > 0 ? this.startTime + limits.softMs : Infinity;
    this.killers.fill(0);
    this.history.fill(0);

    // Root legal moves.
    const rootScratch = new Int32Array(256);
    const n = pos.generateInto(rootScratch);
    const rootMoves: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = rootScratch[i]!;
      pos.makeMove(m);
      if (!pos.inCheck(other(pos.stm))) rootMoves.push(m);
      pos.undoMove();
    }
    if (rootMoves.length === 0) {
      return {
        bestMove: 0, score: pos.inCheck() ? -MATE_SCORE : 0,
        depth: 0, nodes: 0, ms: 0, pv: [], rootScores: [],
      };
    }

    let bestMove = rootMoves[0]!;
    let bestScore = 0;
    let completedDepth = 0;
    let pv: number[] = [];
    let rootScores: MoveScore[] = rootMoves.map((m) => ({ move: m, score: 0 }));

    for (let depth = 1; depth <= limits.maxDepth; depth++) {
      const result = this.searchRoot(rootMoves, depth, opts?.rankRoot ?? false);
      if (this.stopped && depth > 1) break;

      rootScores = result.scores.slice().sort((a, b) => b.score - a.score);
      rootMoves.length = 0;
      for (const s of rootScores) rootMoves.push(s.move);
      bestMove = rootMoves[0]!;
      bestScore = rootScores[0]!.score;
      completedDepth = depth;
      pv = this.extractPv(pos, bestMove, depth);

      opts?.onDepth?.({ depth, score: bestScore, nodes: this.nodes, ms: Date.now() - this.startTime });

      if (Math.abs(bestScore) >= MATE_BOUND) break;
      if (limits.softMs > 0 && Date.now() - this.startTime > limits.softMs * 0.5) break;
    }

    return { bestMove, score: bestScore, depth: completedDepth, nodes: this.nodes, ms: Date.now() - this.startTime, pv, rootScores };
  }

  private searchRoot(rootMoves: number[], depth: number, rankAll: boolean): { scores: MoveScore[] } {
    const pos = this.pos;
    const scores: MoveScore[] = [];
    let alpha = -INF;
    for (let i = 0; i < rootMoves.length; i++) {
      const m = rootMoves[i]!;
      pos.makeMove(m);
      let score: number;
      if (rankAll || i === 0) {
        score = -this.negamax(depth - 1, -INF, INF, 1, true);
      } else {
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true);
        if (score > alpha) score = -this.negamax(depth - 1, -INF, -alpha, 1, true);
      }
      pos.undoMove();
      scores.push({ move: m, score });
      if (score > alpha) alpha = score;
      if (this.stopped && depth > 1) break;
    }
    return { scores };
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, canNull: boolean): number {
    const pos = this.pos;
    this.nodes++;

    if ((this.nodes & 2047) === 0 && Date.now() >= this.deadline) this.stopped = true;
    if (this.stopped) return 0;

    if (ply > 0 && (pos.isRepetition() || pos.isDrawByFiftyMoves() || pos.isInsufficientMaterial())) return 0;

    const inCheck = pos.inCheck();
    if (inCheck) depth++;

    if (depth <= 0) return this.useQuiescence ? this.qsearch(alpha, beta, ply) : this.evalNow();

    // Mate-distance pruning.
    alpha = Math.max(alpha, -MATE_SCORE + ply);
    beta = Math.min(beta, MATE_SCORE - ply - 1);
    if (alpha >= beta) return alpha;

    const ttEntry = this.tt.probe(pos.hash.lo, pos.hash.hi);
    const ttMove = ttEntry?.move ?? 0;
    if (ttEntry && ttEntry.depth >= depth) {
      let s = ttEntry.score;
      // Mate scores are stored relative to the storing node — shift back to
      // this ply before using (classic TT mate-distance correction).
      if (s > MATE_BOUND) s -= ply;
      else if (s < -MATE_BOUND) s += ply;
      if (ttEntry.flag === TT_EXACT) return s;
      if (ttEntry.flag === TT_ALPHA && s <= alpha) return s;
      if (ttEntry.flag === TT_BETA && s >= beta) return s;
    }

    // Null-move pruning.
    if (canNull && !inCheck && depth >= 3 && pos.hasNonPawnMaterial(pos.stm) && !isRepetitionRisk(pos)) {
      pos.makeNull();
      const r = 2 + (depth >> 2);
      const score = -this.negamax(depth - 1 - r, -beta, -beta + 1, ply + 1, false);
      pos.undoMove();
      if (this.stopped) return 0;
      if (score >= beta) return beta;
    }

    const buf = this.buffers[ply]!;
    const sc = this.scores[ply]!;
    const n = pos.generateInto(buf);
    this.scoreMoves(buf, sc, n, ttMove, ply, pos);

    let bestScore = -INF;
    let bestMove = 0;
    let flag = TT_ALPHA;
    let legalCount = 0;
    const isPv = beta - alpha > 1;

    for (let i = 0; i < n; i++) {
      // Selection sort step: bring the highest-scored remaining move forward.
      let bestIdx = i;
      for (let j = i + 1; j < n; j++) if (sc[j]! > sc[bestIdx]!) bestIdx = j;
      if (bestIdx !== i) {
        const tm = buf[i]!;
        buf[i] = buf[bestIdx]!;
        buf[bestIdx] = tm;
        const ts = sc[i]!;
        sc[i] = sc[bestIdx]!;
        sc[bestIdx] = ts;
      }
      const m = buf[i]!;

      pos.makeMove(m);
      if (pos.inCheck(other(pos.stm))) {
        pos.undoMove();
        continue;
      }
      legalCount++;
      const quiet = pos.pieceAt(moveTo(m)) === 0 && moveFlag(m) !== FLAG_EN_PASSANT && movePromo(m) === 0;
      const givesCheck = pos.inCheck();

      let reduction = 0;
      if (depth >= 3 && legalCount > 3 && quiet && !inCheck && !givesCheck && !isPv) {
        reduction = legalCount > 8 ? 2 : 1;
      }

      let score: number;
      if (legalCount === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction > 0) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      pos.undoMove();

      if (this.stopped) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          flag = TT_EXACT;
          if (score >= beta) {
            flag = TT_BETA;
            if (quiet) {
              const kIdx = ply * 2;
              if (this.killers[kIdx] !== m) {
                this.killers[kIdx + 1] = this.killers[kIdx]!;
                this.killers[kIdx] = m;
              }
              const piece = pos.pieceAt(moveFrom(m));
              this.history[piece * 128 + moveTo(m)] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legalCount === 0) return inCheck ? -MATE_SCORE + ply : 0;

    // Store mate scores relative to this node so TT entries stay ply-independent.
    let storeScore = bestScore;
    if (storeScore > MATE_BOUND) storeScore += ply;
    else if (storeScore < -MATE_BOUND) storeScore -= ply;
    this.tt.store(pos.hash.lo, pos.hash.hi, depth, storeScore, flag, bestMove);
    return bestScore;
  }

  private qsearch(alpha: number, beta: number, ply: number): number {
    const pos = this.pos;
    this.nodes++;
    if ((this.nodes & 2047) === 0 && Date.now() >= this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    if (ply >= MAX_TOTAL_PLY) return this.evalNow();

    const inCheck = pos.inCheck();
    let standPat = -INF;
    if (!inCheck) {
      standPat = this.evalNow();
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    }

    const buf = this.buffers[Math.min(this.buffers.length - 1, ply)]!;
    const sc = this.scores[Math.min(this.scores.length - 1, ply)]!;
    const n = pos.generateInto(buf, !inCheck);
    this.scoreMoves(buf, sc, n, 0, ply, pos, true);

    let bestScore = inCheck ? -INF : standPat;
    let legalCount = 0;

    for (let i = 0; i < n; i++) {
      let bestIdx = i;
      for (let j = i + 1; j < n; j++) if (sc[j]! > sc[bestIdx]!) bestIdx = j;
      if (bestIdx !== i) {
        const tm = buf[i]!;
        buf[i] = buf[bestIdx]!;
        buf[bestIdx] = tm;
        const ts = sc[i]!;
        sc[i] = sc[bestIdx]!;
        sc[bestIdx] = ts;
      }
      const m = buf[i]!;

      if (!inCheck) {
        const victim = moveFlag(m) === FLAG_EN_PASSANT ? PAWN : pos.pieceAt(moveTo(m));
        const gain = victim ? PIECE_VALUE_CP[typeOf(victim)]! : 0;
        if (standPat + gain + 200 <= alpha && !movePromo(m)) continue;
      }

      pos.makeMove(m);
      if (pos.inCheck(other(pos.stm))) {
        pos.undoMove();
        continue;
      }
      legalCount++;
      const score = -this.qsearch(-beta, -alpha, ply + 1);
      pos.undoMove();
      if (this.stopped) return 0;
      if (score > bestScore) {
        bestScore = score;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) return score;
        }
      }
    }

    if (inCheck && legalCount === 0) return -MATE_SCORE + ply;
    return bestScore;
  }

  private evalNow(): number {
    return this.profile === 'full' ? evaluateFull(this.pos) : evaluateBasic(this.pos);
  }

  /** Scores moves in place for the selection-sort iteration (no allocation). */
  private scoreMoves(buf: Int32Array, sc: Float64Array, n: number, ttMove: number, ply: number, pos: Position, capturesOnly = false): void {
    const k1 = this.killers[ply * 2]!;
    const k2 = this.killers[ply * 2 + 1]!;
    for (let i = 0; i < n; i++) {
      const m = buf[i]!;
      let s: number;
      const victim = moveFlag(m) === FLAG_EN_PASSANT ? PAWN : pos.pieceAt(moveTo(m));
      const isCap = victim !== 0;
      if (m === ttMove) s = 1e9;
      else if (isCap || movePromo(m) !== 0) {
        const victimVal = victim ? PIECE_VALUE_CP[typeOf(victim)]! : 0;
        const attackerVal = PIECE_VALUE_CP[typeOf(pos.pieceAt(moveFrom(m)))]!;
        s = 1e8 + victimVal * 100 - attackerVal + (movePromo(m) ? 900 : 0);
      } else if (m === k1) s = 9e7;
      else if (m === k2) s = 8.9e7;
      else {
        const piece = pos.pieceAt(moveFrom(m));
        s = this.history[piece * 128 + moveTo(m)]!;
        if (capturesOnly) s = -1; // in evasion mode, quiet moves come last
      }
      sc[i] = s;
    }
  }

  /** Walks the TT to rebuild the principal variation. */
  private extractPv(pos: Position, firstMove: number, maxLen: number): number[] {
    const pv: number[] = [firstMove];
    pos.makeMove(firstMove);
    let made = 1;
    for (let i = 1; i < maxLen + 4; i++) {
      const entry = this.tt.probe(pos.hash.lo, pos.hash.hi);
      if (!entry || !entry.move) break;
      const legal = pos
        .getLegalMoves()
        .find((mv) => mv.from === moveFrom(entry.move) && mv.to === moveTo(entry.move) && (mv.promo ?? 0) === movePromo(entry.move));
      if (!legal) break;
      const enc = legal.from | (legal.to << 7) | ((legal.promo ?? 0) << 14) | (legal.flag << 17);
      pv.push(enc);
      pos.makeMove(enc);
      made++;
    }
    pos.undoMany(made);
    return pv;
  }
}

/** Detects simple repetition-draw shapes where null move is unsafe. */
function isRepetitionRisk(pos: Position): boolean {
  return pos.halfmove >= 8 && pos.isRepetition();
}

export { INF };
export type { SearchLimits, SearchResult, MoveScore };
export { colorOf };
