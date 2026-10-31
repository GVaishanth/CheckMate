/**
 * Position — complete chess rules implementation on a 0x88 board.
 *
 * Responsibilities:
 *   - legal + pseudo-legal move generation (castling, en passant, promotion)
 *   - make / undo with allocation-free typed-array stacks (search hot path)
 *   - incremental Zobrist hashing + tapered PST score, repetition & 50-move tracking
 *   - FEN import/export, UCI move replay
 *
 * The UI never implements chess rules itself; it talks to this class only.
 */
import { BLACK, B_B, B_W, CASTLE_ALL, CASTLE_BK, CASTLE_BQ, CASTLE_WK, CASTLE_WQ, ChessVariant, Color, EMPTY, FILES, FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_DOUBLE, FLAG_EN_PASSANT, FLAG_NORMAL, KING, KING_OFFSETS, KNIGHT, KNIGHT_OFFSETS, K_B, K_W, Move, N_B, N_W, PAWN, PieceType, QUEEN_DIRS, Q_B, Q_W, ROOK_DIRS, R_B, R_W, START_FEN, WHITE, algebraic, colorOf, decodeMove, encodeMove, fromAlgebraic, makePiece, moveFlag, moveFrom, movePromo, moveTo, onBoard, other, rankOf, typeOf } from './constants';
import { HashState, hashCastling, hashChecks, hashEp, hashPiece, hashSide, hashVariant } from './zobrist';
import { PST_EG, PST_MG, pstIndexOf } from './pst';

export class ChessError extends Error {}

interface UndoEntry {
  move: number;      // 0 marks a null move
  captured: number;
  castling: number;
  ep: number;
  halfmove: number;
  hashLo: number;
  hashHi: number;
}

const BISHOP_DIRS = [-17, -15, 15, 17] as const;

export class Position {
  board = new Int8Array(128);
  stm: Color = WHITE;
  castling: number = CASTLE_ALL;
  ep = -1; // en-passant target square, kept only when a capture is pseudo-legal
  halfmove = 0;
  fullmove = 1;
  variant: ChessVariant = 'standard';
  /** Checks delivered by each side (three-check only). */
  checksGiven: [number, number] = [0, 0];
  kings: [number, number] = [0, 0];
  hash: HashState = { lo: 0, hi: 0 };
  ply = 0; // half-moves played since the position was loaded
  /** FEN this position was loaded from. */
  startFen: string = START_FEN;
  /** Encoded moves made since load (drives SAN lists, PGN export, review). */
  moves: number[] = [];

  /** Hashes after each make (lo,hi pairs). Index 0 = the loaded position. */
  hashHistory: number[] = [];

  private undo: UndoEntry[] = [];
  private undoSp = 0;

  /** countByPiece[pieceCode], maintained incrementally. */
  readonly counts = new Int16Array(15);
  /** Incremental tapered PST score per color [mg, eg] (material included in PST values via MATERIAL_PST below). */
  readonly pstScore: [Int32Array, Int32Array] = [new Int32Array(2), new Int32Array(2)];

  private legalCache: Move[] | null = null;
  private genScratch = new Int32Array(256);

  // ------------------------------------------------------------------ setup

  static initial(): Position {
    return Position.fromFen(START_FEN);
  }

  static fromFen(fen: string): Position {
    const p = new Position();
    p.loadFen(fen);
    return p;
  }

  loadFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new ChessError(`FEN needs at least 4 fields, got ${parts.length}`);
    const [placement, stmField, castleField, epField, halfmoveField, fullmoveField] = parts;

    this.board.fill(EMPTY);
    let rank = 7;
    let file = 0;
    for (const ch of placement) {
      if (ch === '/') {
        if (file !== 8 || rank === 0) throw new ChessError('Bad FEN board layout');
        rank--;
        file = 0;
      } else if (ch >= '1' && ch <= '8') {
        file += ch.charCodeAt(0) - 48;
        if (file > 8) throw new ChessError('Bad FEN board layout');
      } else {
        if (file > 7) throw new ChessError('Bad FEN board layout');
        const lower = ch.toLowerCase();
        const type = { p: PAWN, n: KNIGHT, b: 3, r: 4, q: 5, k: KING }[lower as 'p' | 'n' | 'b' | 'r' | 'q' | 'k'];
        if (!type) throw new ChessError(`Unknown piece "${ch}" in FEN`);
        this.board[(rank << 4) | file] = makePiece(type as PieceType, ch === lower ? BLACK : WHITE);
        file++;
      }
    }
    if (rank !== 0 || file !== 8) throw new ChessError('Bad FEN board layout');

    if (stmField !== 'w' && stmField !== 'b') throw new ChessError(`Bad side to move "${stmField}"`);
    this.stm = stmField === 'w' ? WHITE : BLACK;

    this.castling = 0;
    if (castleField !== '-') {
      for (const ch of castleField) {
        const bit = { K: CASTLE_WK, Q: CASTLE_WQ, k: CASTLE_BK, q: CASTLE_BQ }[ch as 'K' | 'Q' | 'k' | 'q'];
        if (!bit) throw new ChessError(`Bad castling field "${castleField}"`);
        this.castling |= bit;
      }
    }

    this.ep = -1;
    if (epField && epField !== '-') {
      if (!/^[a-h][36]$/.test(epField)) throw new ChessError(`Bad en-passant square "${epField}"`);
      this.ep = fromAlgebraic(epField);
    }

    this.halfmove = halfmoveField !== undefined ? this.parseCount(halfmoveField, 'halfmove clock') : 0;
    this.fullmove = fullmoveField !== undefined ? Math.max(1, this.parseCount(fullmoveField, 'fullmove')) : 1;

    // Derived state.
    let wk = -1;
    let bk = -1;
    this.counts.fill(0);
    this.pstScore[0].fill(0);
    this.pstScore[1].fill(0);
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) continue;
      const piece = this.board[sq]!;
      if (!piece) continue;
      this.counts[piece]++;
      if (piece === K_W) wk = sq;
      if (piece === K_B) bk = sq;
      const c = colorOf(piece);
      this.pstScore[0][c] += pstWithMaterial(piece, sq, 0);
      this.pstScore[1][c] += pstWithMaterial(piece, sq, 1);
    }
    if (wk < 0 || bk < 0) throw new ChessError('FEN must contain both kings');
    if (Math.abs(rankOf(wk) - rankOf(bk)) <= 1 && Math.abs((wk & 7) - (bk & 7)) <= 1) {
      throw new ChessError('Kings adjacent in FEN');
    }
    this.kings = [wk, bk];
    const idle = other(this.stm);
    if (this.isSquareAttacked(this.kings[idle], this.stm)) {
      throw new ChessError('Illegal FEN: the side not to move is in check');
    }

    // Normalize: drop an en-passant square no pawn can pseudo-legally capture.
    if (this.ep >= 0 && !this.epCapturable()) this.ep = -1;

    this.ply = 0;
    this.undoSp = 0;
    this.legalCache = null;
    this.computeHash();
    this.hashHistory = [this.hash.lo, this.hash.hi];
  }

  private parseCount(s: string, what: string): number {
    if (!/^\d+$/.test(s)) throw new ChessError(`Bad ${what} "${s}"`);
    return parseInt(s, 10);
  }

  private variantId(): number {
    return this.variant === 'standard' ? 0 : this.variant === 'three-check' ? 1 : 2;
  }

  private computeHash(): void {
    this.hash.lo = 0;
    this.hash.hi = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) continue;
      const piece = this.board[sq]!;
      if (piece) hashPiece(this.hash, piece, sq);
    }
    hashCastling(this.hash, this.castling);
    if (this.ep >= 0) hashEp(this.hash, this.ep & 7);
    if (this.stm === BLACK) hashSide(this.hash);
    hashVariant(this.hash, this.variantId());
    if (this.variant === 'three-check') {
      hashChecks(this.hash, 0, this.checksGiven[0]);
      hashChecks(this.hash, 1, this.checksGiven[1]);
    }
  }

  fen(): string {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[(rank << 4) | file]!;
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          out += empty;
          empty = 0;
        }
        out += fenChar(piece);
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    let castle = '';
    if (this.castling & CASTLE_WK) castle += 'K';
    if (this.castling & CASTLE_WQ) castle += 'Q';
    if (this.castling & CASTLE_BK) castle += 'k';
    if (this.castling & CASTLE_BQ) castle += 'q';
    return `${out} ${this.stm === WHITE ? 'w' : 'b'} ${castle || '-'} ${
      this.ep >= 0 ? algebraic(this.ep) : '-'
    } ${this.halfmove} ${this.fullmove}`;
  }

  /**
   * Switch the rule variant on a freshly loaded position (FEN carries no
   * variant field). Must be called before the first makeMove so the hash
   * history root stays consistent.
   */
  applyVariant(v: ChessVariant): void {
    if (v === this.variant) return;
    this.variant = v;
    this.checksGiven = [0, 0];
    this.computeHash();
    this.hashHistory = [this.hash.lo, this.hash.hi];
    this.legalCache = null;
  }

  clone(): Position {
    const p = new Position();
    p.variant = this.variant;
    p.checksGiven = [this.checksGiven[0], this.checksGiven[1]];
    p.board.set(this.board);
    p.stm = this.stm;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kings = [this.kings[0], this.kings[1]];
    p.hash = { lo: this.hash.lo, hi: this.hash.hi };
    p.ply = this.ply;
    p.hashHistory = this.hashHistory.slice();
    p.undoSp = 0;
    p.legalCache = null;
    p.counts.set(this.counts);
    p.pstScore[0].set(this.pstScore[0]);
    p.pstScore[1].set(this.pstScore[1]);
    return p;
  }

  // ---------------------------------------------------------------- attacks

  /** Is `sq` attacked by any piece of color `by`? Hot path — keep tight. */
  isSquareAttacked(sq: number, by: Color): boolean {
    const b = this.board;
    if (by === WHITE) {
      const p1 = sq - 15, p2 = sq - 17;
      if ((p1 & 0x88) === 0 && b[p1] === 0x01) return true;
      if ((p2 & 0x88) === 0 && b[p2] === 0x01) return true;
    } else {
      const p1 = sq + 15, p2 = sq + 17;
      if ((p1 & 0x88) === 0 && b[p1] === 0x09) return true;
      if ((p2 & 0x88) === 0 && b[p2] === 0x09) return true;
    }
    const knight = by === WHITE ? N_W : N_B;
    for (let i = 0; i < 8; i++) {
      const t = sq + KNIGHT_OFFSETS[i]!;
      if ((t & 0x88) === 0 && b[t] === knight) return true;
    }
    const king = by === WHITE ? K_W : K_B;
    for (let i = 0; i < 8; i++) {
      const t = sq + KING_OFFSETS[i]!;
      if ((t & 0x88) === 0 && b[t] === king) return true;
    }
    const bish = by === WHITE ? B_W : B_B;
    const queen = by === WHITE ? Q_W : Q_B;
    for (let i = 0; i < 4; i++) {
      const d = BISHOP_DIRS[i]!;
      let t = sq + d;
      while ((t & 0x88) === 0) {
        const p = b[t]!;
        if (p) {
          if (p === bish || p === queen) return true;
          break;
        }
        t += d;
      }
    }
    const rook = by === WHITE ? R_W : R_B;
    for (let i = 0; i < 4; i++) {
      const d = ROOK_DIRS[i]!;
      let t = sq + d;
      while ((t & 0x88) === 0) {
        const p = b[t]!;
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
        t += d;
      }
    }
    return false;
  }

  inCheck(color: Color = this.stm): boolean {
    return this.isSquareAttacked(this.kings[color], other(color));
  }

  // -------------------------------------------------------- move generation

  /** Pseudo-legal move generation into `out`; returns move count. Hot path. */
  generateInto(out: Int32Array, capturesOnly = false): number {
    const b = this.board;
    const us = this.stm;
    let n = 0;

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const piece = b[sq]!;
      if (!piece || colorOf(piece) !== us) continue;
      const type = typeOf(piece);

      if (type === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const promoRank = us === WHITE ? 6 : 1;
        const startRank = us === WHITE ? 1 : 6;
        const one = sq + fwd;
        if (!capturesOnly && (one & 0x88) === 0 && !b[one]) {
          if (rankOf(sq) === promoRank) {
            out[n++] = encodeMove(sq, one, 5, FLAG_NORMAL);
            out[n++] = encodeMove(sq, one, 2, FLAG_NORMAL);
            out[n++] = encodeMove(sq, one, 4, FLAG_NORMAL);
            out[n++] = encodeMove(sq, one, 3, FLAG_NORMAL);
          } else {
            out[n++] = encodeMove(sq, one, 0, FLAG_NORMAL);
            if (rankOf(sq) === startRank) {
              const two = one + fwd;
              if (!b[two]) out[n++] = encodeMove(sq, two, 0, FLAG_DOUBLE);
            }
          }
        }
        for (let k = 0; k < 2; k++) {
          const t = sq + fwd + (k === 0 ? -1 : 1);
          if (t & 0x88) continue;
          const target = b[t]!;
          if (target && colorOf(target) !== us) {
            if (rankOf(sq) === promoRank) {
              out[n++] = encodeMove(sq, t, 5, FLAG_NORMAL);
              out[n++] = encodeMove(sq, t, 2, FLAG_NORMAL);
              out[n++] = encodeMove(sq, t, 4, FLAG_NORMAL);
              out[n++] = encodeMove(sq, t, 3, FLAG_NORMAL);
            } else {
              out[n++] = encodeMove(sq, t, 0, FLAG_NORMAL);
            }
          } else if (t === this.ep) {
            out[n++] = encodeMove(sq, t, 0, FLAG_EN_PASSANT);
          }
        }
        continue;
      }

      if (type === KNIGHT) {
        for (let i = 0; i < 8; i++) {
          const t = sq + KNIGHT_OFFSETS[i]!;
          if (t & 0x88) continue;
          const target = b[t]!;
          if (target ? colorOf(target) !== us : !capturesOnly) out[n++] = encodeMove(sq, t);
        }
        continue;
      }

      if (type === KING) {
        for (let i = 0; i < 8; i++) {
          const t = sq + KING_OFFSETS[i]!;
          if (t & 0x88) continue;
          const target = b[t]!;
          if (target ? colorOf(target) !== us : !capturesOnly) out[n++] = encodeMove(sq, t);
        }
        if (!capturesOnly && this.castling) {
          const home = us === WHITE ? 0x04 : 0x74;
          if (sq === home && !this.isSquareAttacked(sq, other(us))) {
            const them = other(us);
            const kBit = us === WHITE ? CASTLE_WK : CASTLE_BK;
            const qBit = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
            const f = home + 1, g = home + 2, dS = home - 1, cS = home - 2, bS = home - 3;
            if (
              (this.castling & kBit) && !b[f] && !b[g] && b[home + 3] === (us === WHITE ? R_W : R_B) &&
              !this.isSquareAttacked(f, them) && !this.isSquareAttacked(g, them)
            ) {
              out[n++] = encodeMove(sq, g, 0, FLAG_CASTLE_K);
            }
            if (
              (this.castling & qBit) && !b[bS] && !b[cS] && !b[dS] && b[home - 4] === (us === WHITE ? R_W : R_B) &&
              !this.isSquareAttacked(dS, them) && !this.isSquareAttacked(cS, them)
            ) {
              out[n++] = encodeMove(sq, cS, 0, FLAG_CASTLE_Q);
            }
          }
        }
        continue;
      }

      // Sliders: bishop(3) / rook(4) / queen(5).
      const dirs = type === 4 ? ROOK_DIRS : type === 3 ? BISHOP_DIRS : QUEEN_DIRS;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i]!;
        let t = sq + d;
        while ((t & 0x88) === 0) {
          const target = b[t]!;
          if (!target) {
            if (!capturesOnly) out[n++] = encodeMove(sq, t);
          } else {
            if (colorOf(target) !== us) out[n++] = encodeMove(sq, t);
            break;
          }
          t += d;
        }
      }
    }
    return n;
  }

  private genBuffer = new Int32Array(256);

  /** All pseudo-legal moves as encoded integers (allocates). */
  pseudoMoves(capturesOnly = false): number[] {
    const n = this.generateInto(this.genBuffer, capturesOnly);
    return Array.from(this.genBuffer.subarray(0, n));
  }

  /** Fully legal moves (cached until the position changes). */
  getLegalMoves(): Move[] {
    if (this.legalCache) return this.legalCache;
    const n = this.generateInto(this.genScratch);
    const legal: Move[] = [];
    for (let i = 0; i < n; i++) {
      const m = this.genScratch[i]!;
      this.makeMove(m);
      if (!this.inCheck(other(this.stm))) legal.push(decodeMove(m));
      this.undoMove();
    }
    this.legalCache = legal;
    return legal;
  }

  movesFrom(sq: number): Move[] {
    return this.getLegalMoves().filter((m) => m.from === sq);
  }

  /** Finds the legal move matching from/to/promo, or null. */
  findMove(from: number, to: number, promo: PieceType | null = null): Move | null {
    for (const m of this.getLegalMoves()) {
      if (m.from === from && m.to === to && (!promo || m.promo === promo)) return m;
    }
    return null;
  }

  // -------------------------------------------------------------- make/undo

  private growUndo(): UndoEntry {
    if (this.undoSp >= this.undo.length) {
      for (let i = 0; i < 256; i++) {
        this.undo.push({ move: 0, captured: 0, castling: 0, ep: -1, halfmove: 0, hashLo: 0, hashHi: 0 });
      }
    }
    return this.undo[this.undoSp++]!;
  }

  makeMove(m: number): void {
    const from = moveFrom(m), to = moveTo(m), flag = moveFlag(m), promo = movePromo(m);
    const b = this.board;
    const us = this.stm;
    const piece = b[from]!;
    const isEp = flag === FLAG_EN_PASSANT;
    const capSq = isEp ? (us === WHITE ? to - 16 : to + 16) : to;
    const captured = isEp ? b[capSq]! : b[to]!;

    const e = this.growUndo();
    e.move = m;
    e.captured = captured;
    e.castling = this.castling;
    e.ep = this.ep;
    e.halfmove = this.halfmove;
    e.hashLo = this.hash.lo;
    e.hashHi = this.hash.hi;

    // Hash out the old state (castling is hashed unconditionally in/out).
    hashPiece(this.hash, piece, from);
    if (captured) hashPiece(this.hash, captured, capSq);
    hashCastling(this.hash, this.castling);
    if (this.ep >= 0) hashEp(this.hash, this.ep & 7);

    if (isEp) b[capSq] = EMPTY;
    b[from] = EMPTY;
    const placed = promo ? makePiece(promo as PieceType, us) : piece;
    b[to] = placed;
    hashPiece(this.hash, placed, to);

    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const rookFrom = flag === FLAG_CASTLE_K ? (us === WHITE ? 0x07 : 0x77) : (us === WHITE ? 0x00 : 0x70);
      const rookTo = flag === FLAG_CASTLE_K ? rookFrom - 2 : rookFrom + 3;
      const rook = b[rookFrom]!;
      hashPiece(this.hash, rook, rookFrom);
      b[rookFrom] = EMPTY;
      b[rookTo] = rook;
      hashPiece(this.hash, rook, rookTo);
      this.pstScore[0][us] += PST_MG[4]![pstIndexOf(rookTo)] - PST_MG[4]![pstIndexOf(rookFrom)];
      this.pstScore[1][us] += PST_EG[4]![pstIndexOf(rookTo)] - PST_EG[4]![pstIndexOf(rookFrom)];
    }

    // Counts + incremental PST.
    this.counts[piece]--;
    this.counts[placed]++;
    const them = other(us);
    if (captured) this.counts[captured]--;
    this.pstScore[0][us] += pstWithMaterial(placed, to, 0) - pstWithMaterial(piece, from, 0);
    this.pstScore[1][us] += pstWithMaterial(placed, to, 1) - pstWithMaterial(piece, from, 1);
    if (captured) {
      this.pstScore[0][them] -= pstWithMaterial(captured, capSq, 0);
      this.pstScore[1][them] -= pstWithMaterial(captured, capSq, 1);
    }

    // Castling rights.
    this.castling &= CASTLE_RIGHTS_MASK[from]! & CASTLE_RIGHTS_MASK[to]!;
    hashCastling(this.hash, this.castling);

    // En-passant target: kept only when a capture is pseudo-legally available.
    this.ep = -1;
    if (flag === FLAG_DOUBLE) {
      const behind = us === WHITE ? to - 16 : to + 16;
      const theirPawn = us === WHITE ? 0x09 : 0x01;
      const l = to - 1, r = to + 1;
      if (((l & 0x88) === 0 && b[l] === theirPawn) || ((r & 0x88) === 0 && b[r] === theirPawn)) {
        this.ep = behind;
        hashEp(this.hash, behind & 7);
      }
    }

    if (typeOf(piece) === KING) this.kings[us] = to;
    this.halfmove = typeOf(piece) === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.stm = them;
    hashSide(this.hash);
    // Three-check: a delivered check advances the counter (and the hash).
    if (this.variant === 'three-check' && this.inCheck(them)) {
      hashChecks(this.hash, us, this.checksGiven[us]);
      this.checksGiven[us]++;
      hashChecks(this.hash, us, this.checksGiven[us]);
    }
    this.ply++;
    this.hashHistory.push(this.hash.lo, this.hash.hi);
    this.legalCache = null;
  }

  undoMove(): void {
    const e = this.undo[--this.undoSp]!;
    if (e.move === 0) {
      this.undoNullEntry(e);
      return;
    }
    const from = moveFrom(e.move), to = moveTo(e.move), flag = moveFlag(e.move), promo = movePromo(e.move);
    const b = this.board;
    const us = other(this.stm);
    // Three-check: the move being undone delivered a check iff the current
    // side to move stands in check.
    if (this.variant === 'three-check' && this.inCheck(this.stm)) this.checksGiven[us]--;
    this.stm = us as Color;
    if (us === BLACK) this.fullmove--;

    const isEp = flag === FLAG_EN_PASSANT;
    const capSq = isEp ? (us === WHITE ? to - 16 : to + 16) : to;
    const placed = b[to]!;
    const movedBack = promo ? makePiece(PAWN, us) : placed;

    b[from] = movedBack;
    b[to] = isEp ? EMPTY : e.captured;
    if (isEp) b[capSq] = e.captured;

    if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const rookFrom = flag === FLAG_CASTLE_K ? (us === WHITE ? 0x07 : 0x77) : (us === WHITE ? 0x00 : 0x70);
      const rookTo = flag === FLAG_CASTLE_K ? rookFrom - 2 : rookFrom + 3;
      b[rookFrom] = b[rookTo]!;
      b[rookTo] = EMPTY;
      this.pstScore[0][us] -= PST_MG[4]![pstIndexOf(rookTo)] - PST_MG[4]![pstIndexOf(rookFrom)];
      this.pstScore[1][us] -= PST_EG[4]![pstIndexOf(rookTo)] - PST_EG[4]![pstIndexOf(rookFrom)];
    }

    // Counts + PST back.
    this.counts[placed]--;
    this.counts[movedBack]++;
    if (e.captured) this.counts[e.captured]++;
    const them = other(us as Color);
    this.pstScore[0][us] -= pstWithMaterial(placed, to, 0) - pstWithMaterial(movedBack, from, 0);
    this.pstScore[1][us] -= pstWithMaterial(placed, to, 1) - pstWithMaterial(movedBack, from, 1);
    if (e.captured) {
      this.pstScore[0][them] += pstWithMaterial(e.captured, capSq, 0);
      this.pstScore[1][them] += pstWithMaterial(e.captured, capSq, 1);
    }

    if (typeOf(movedBack) === KING) this.kings[us] = from;
    this.castling = e.castling;
    this.ep = e.ep;
    this.halfmove = e.halfmove;
    this.hash.lo = e.hashLo;
    this.hash.hi = e.hashHi;
    this.ply--;
    this.hashHistory.length -= 2;
    this.legalCache = null;
  }

  /** Null move (null-move pruning). Does not touch hashHistory. */
  makeNull(): void {
    const e = this.growUndo();
    e.move = 0;
    e.captured = 0;
    e.castling = this.castling;
    e.ep = this.ep;
    e.halfmove = this.halfmove;
    e.hashLo = this.hash.lo;
    e.hashHi = this.hash.hi;
    if (this.ep >= 0) hashEp(this.hash, this.ep & 7);
    this.ep = -1;
    this.halfmove++;
    this.stm = other(this.stm);
    hashSide(this.hash);
    this.legalCache = null;
  }

  private undoNullEntry(e: UndoEntry): void {
    this.stm = other(this.stm);
    this.castling = e.castling;
    this.ep = e.ep;
    this.halfmove = e.halfmove;
    this.hash.lo = e.hashLo;
    this.hash.hi = e.hashHi;
    this.legalCache = null;
  }

  // ----------------------------------------------------------- game state

  /** King of the Hill: the king reached a center square (d4/e4/d5/e5). */
  kingOnHill(color: Color): boolean {
    const k = this.kings[color];
    return k === 0x33 || k === 0x34 || k === 0x43 || k === 0x44;
  }

  /** Variant win condition met (color), or null while the game runs. */
  variantWinner(): Color | null {
    if (this.variant === 'koth') {
      if (this.kingOnHill(WHITE)) return WHITE;
      if (this.kingOnHill(BLACK)) return BLACK;
      return null;
    }
    if (this.variant === 'three-check') {
      if (this.checksGiven[0] >= 3) return WHITE;
      if (this.checksGiven[1] >= 3) return BLACK;
    }
    return null;
  }

  isCheckmate(): boolean {
    return this.inCheck() && this.getLegalMoves().length === 0;
  }

  isStalemate(): boolean {
    return !this.inCheck() && this.getLegalMoves().length === 0;
  }

  /** Occurrences of the current position (>= 3 = threefold repetition). */
  repetitionCount(): number {
    const hh = this.hashHistory;
    const len = hh.length / 2;
    const lo = this.hash.lo;
    const hi = this.hash.hi;
    let count = 0;
    const stop = Math.max(0, len - 1 - this.halfmove);
    for (let i = len - 3; i >= stop; i -= 2) {
      if (hh[i * 2] === lo && hh[i * 2 + 1] === hi) count++;
    }
    return count + 1;
  }

  /** True if the current position occurred earlier in the game (search helper). */
  isRepetition(): boolean {
    const hh = this.hashHistory;
    const len = hh.length / 2;
    const lo = this.hash.lo;
    const hi = this.hash.hi;
    const stop = Math.max(0, len - 1 - this.halfmove);
    for (let i = len - 3; i >= stop; i -= 2) {
      if (hh[i * 2] === lo && hh[i * 2 + 1] === hi) return true;
    }
    return false;
  }

  isDrawByFiftyMoves(): boolean {
    return this.halfmove >= 100;
  }

  isInsufficientMaterial(): boolean {
    // King of the Hill: bare kings can still win by reaching the center,
    // so no material count is dead while the hill decides the game.
    if (this.variant === 'koth') return false;
    let minors = 0;
    let bishops = 0;
    let bishopSquareColors = 0;
    for (let piece = 1; piece < 15; piece++) {
      const c = this.counts[piece]!;
      if (!c) continue;
      const t = typeOf(piece);
      if (t === KING) continue;
      if (t === PAWN || t === 4 || t === 5) return false;
      minors += c;
      if (t === 3) {
        bishops += c;
        for (let sq = 0; sq < 128; sq++) {
          if ((sq & 0x88) !== 0 || this.board[sq] !== piece) continue;
          bishopSquareColors |= 1 << (((sq >> 4) + (sq & 7)) & 1);
        }
      }
    }
    if (minors <= 1) return true; // K vs K, K+minor vs K
    if (minors === bishops && bishopSquareColors !== 3) return true; // only same-colored bishops
    return false;
  }

  /** Does `color` have any non-pawn material (null-move safety)? */
  hasNonPawnMaterial(color: Color): boolean {
    const base = color === WHITE ? 1 : 9;
    for (let t = 2; t <= 5; t++) if (this.counts[base + t - 1]) return true;
    return false;
  }

  // -------------------------------------------------------------- helpers

  pieceAt(sq: number): number {
    return this.board[sq]!;
  }

  kingSquare(color: Color): number {
    return this.kings[color];
  }

  playUci(uci: string): void {
    const mv = this.uciToMove(uci);
    if (mv === null) throw new ChessError(`Illegal move "${uci}" in position ${this.fen()}`);
    this.makeMove(mv);
  }

  playUciMoves(moves: string[]): void {
    for (const uci of moves) this.playUci(uci);
  }

  /** Finds + verifies a move from UCI text; returns the encoded move or null. */
  uciToMove(uci: string): number | null {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    const from = fromAlgebraic(uci.slice(0, 2));
    const to = fromAlgebraic(uci.slice(2, 4));
    const promoChar = uci[4];
    const promo = promoChar ? ({ q: 5, r: 4, b: 3, n: 2 } as Record<string, number>)[promoChar]! : 0;
    const n = this.generateInto(this.genScratch);
    for (let i = 0; i < n; i++) {
      const m = this.genScratch[i]!;
      if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo) {
        this.makeMove(m);
        const ok = !this.inCheck(other(this.stm));
        this.undoMove();
        return ok ? m : null;
      }
    }
    return null;
  }

  /** Undo `n` half-moves (takeback / review navigation). */
  undoMany(n: number): void {
    for (let i = 0; i < n && this.undoSp > 0; i++) this.undoMove();
  }

  get canUndo(): boolean {
    return this.undoSp > 0;
  }

  private epCapturable(): boolean {
    const pawn = makePiece(PAWN, this.stm);
    if (this.stm === WHITE) {
      const s1 = this.ep - 15, s2 = this.ep - 17;
      return ((s1 & 0x88) === 0 && this.board[s1] === pawn) || ((s2 & 0x88) === 0 && this.board[s2] === pawn);
    }
    const s1 = this.ep + 15, s2 = this.ep + 17;
    return ((s1 & 0x88) === 0 && this.board[s1] === pawn) || ((s2 & 0x88) === 0 && this.board[s2] === pawn);
  }
}

// PST + material in one lookup (material added so the incremental score is a
// complete "fast evaluation" on its own).
const MATERIAL_BY_TYPE = [0, 100, 320, 330, 500, 900, 0];
export function pstWithMaterial(piece: number, sq: number, phase: 0 | 1): number {
  const t = piece & 7;
  const idx = colorOf(piece) === WHITE ? pstIndexOf(sq) : pstIndexOf(sq ^ 0x70);
  return (phase === 0 ? PST_MG[t]! : PST_EG[t])![idx]! + MATERIAL_BY_TYPE[t]!;
}

// Castling rights per square: rights survive unless the move touches a corner or king home.
const CASTLE_RIGHTS_MASK = new Int8Array(128).fill(CASTLE_ALL);
CASTLE_RIGHTS_MASK[0x00] = CASTLE_ALL & ~CASTLE_WQ; // a1
CASTLE_RIGHTS_MASK[0x07] = CASTLE_ALL & ~CASTLE_WK; // h1
CASTLE_RIGHTS_MASK[0x04] = CASTLE_ALL & ~(CASTLE_WK | CASTLE_WQ); // e1
CASTLE_RIGHTS_MASK[0x70] = CASTLE_ALL & ~CASTLE_BQ; // a8
CASTLE_RIGHTS_MASK[0x77] = CASTLE_ALL & ~CASTLE_BK; // h8
CASTLE_RIGHTS_MASK[0x74] = CASTLE_ALL & ~(CASTLE_BK | CASTLE_BQ); // e8

const fenChar = (piece: number): string => {
  const t = ' pnbrqk'[piece & 7]!;
  return colorOf(piece) === WHITE ? t.toUpperCase() : t;
};

export { FILES };
