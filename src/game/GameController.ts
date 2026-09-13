/**
 * GameController — framework-agnostic game state machine shared by every
 * mode (bots, local, p2p, review). Chess rules live in Position; this class
 * adds game flow: move history, end detection, resignation, draws, takeback.
 *
 * UI frameworks subscribe via onChange(); React binds with useSyncExternalStore.
 */
import { Color, FLAG_EN_PASSANT, Move, PieceType, START_FEN, WHITE, algebraic, encodeMoveObj } from '../chess/constants';
import { Position } from '../chess/position';
import { moveToSan } from '../chess/san';
import { moveToUci } from '../chess/constants';
import type { MoveRecord } from '../storage/schema';

export type GamePhase = 'playing' | 'ended';
export type GameWinner = 'white' | 'black' | null;
export type EndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty-move'
  | 'insufficient'
  | 'agreement'
  | 'resign'
  | 'disconnect';

export interface GameEnd {
  winner: GameWinner;
  reason: EndReason;
}

export interface ControllerConfig {
  whiteName: string;
  blackName: string;
  startFen?: string;
}

export class GameController {
  position: Position;
  phase: GamePhase = 'playing';
  end: GameEnd | null = null;
  moves: MoveRecord[] = [];
  readonly config: ControllerConfig;
  startedAt = Date.now();
  endedAt: number | null = null;

  private listeners = new Set<() => void>();
  private version = 0;

  constructor(config: ControllerConfig) {
    this.config = config;
    this.position = Position.fromFen(config.startFen ?? START_FEN);
  }

  // -------------------------------------------------------------- plumbing

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get moveCount(): number {
    return this.moves.length;
  }

  get turn(): Color {
    return this.position.stm;
  }

  get inCheck(): boolean {
    return this.position.inCheck();
  }

  get checkSquare(): number | null {
    return this.position.inCheck() ? this.position.kingSquare(this.position.stm) : null;
  }

  get lastMove(): { from: number; to: number } | null {
    if (!this.moves.length) return null;
    const m = this.position.moves[this.position.moves.length - 1]!;
    return { from: m & 0x7f, to: (m >> 7) & 0x7f };
  }

  legalMoves(): Move[] {
    return this.phase === 'playing' ? this.position.getLegalMoves() : [];
  }

  movesFrom(sq: number): Move[] {
    return this.legalMoves().filter((m) => m.from === sq);
  }

  /** Attempt a move from UI coordinates; returns the record if accepted. */
  tryMove(from: number, to: number, promo: PieceType | null = null): MoveRecord | null {
    if (this.phase !== 'playing') return null;
    const mv = this.position.findMove(from, to, promo);
    if (!mv) return null;
    return this.applyMove(mv);
  }

  /** Applies an already-validated Move object. */
  applyMove(mv: Move): MoveRecord {
    const san = moveToSan(this.position, mv);
    const uci = moveToUci(encodeMoveObj(mv));
    const capture = this.position.pieceAt(mv.to) !== 0 || mv.flag === FLAG_EN_PASSANT;
    const elapsed = Date.now() - this.startedAt;
    this.position.makeMove(encodeMoveObj(mv));
    const check = this.position.inCheck();
    const record: MoveRecord = { san, uci, fenAfter: this.position.fen(), msElapsed: elapsed, capture, check };
    this.moves.push(record);
    this.checkGameEnd();
    this.emit();
    return record;
  }

  /** Applies a move from UCI (used by network / analysis replay). Returns success. */
  applyUci(uci: string): MoveRecord | null {
    if (this.phase !== 'playing') return null;
    const enc = this.position.uciToMove(uci);
    if (enc === null) return null;
    const mv = {
      from: enc & 0x7f,
      to: (enc >> 7) & 0x7f,
      promo: ((enc >> 14) & 7 || null) as PieceType | null,
      flag: (enc >> 17) & 7,
    };
    return this.applyMove(mv);
  }

  private checkGameEnd(): void {
    const pos = this.position;
    if (pos.isCheckmate()) {
      this.finish(pos.stm === WHITE ? 'black' : 'white', 'checkmate');
    } else if (pos.isStalemate()) {
      this.finish(null, 'stalemate');
    } else if (pos.repetitionCount() >= 3) {
      this.finish(null, 'threefold');
    } else if (pos.isDrawByFiftyMoves()) {
      this.finish(null, 'fifty-move');
    } else if (pos.isInsufficientMaterial()) {
      this.finish(null, 'insufficient');
    }
  }

  resign(loser: Color): void {
    if (this.phase !== 'playing') return;
    this.finish(loser === WHITE ? 'black' : 'white', 'resign');
  }

  drawByAgreement(): void {
    if (this.phase !== 'playing') return;
    this.finish(null, 'agreement');
  }

  endByDisconnect(disconnected: Color): void {
    if (this.phase !== 'playing') return;
    // The player who left loses (standard for direct-play).
    this.finish(disconnected === WHITE ? 'black' : 'white', 'disconnect');
  }

  /** Reset to a fresh game with the same config (used by rematch). */
  reset(): void {
    this.position = Position.fromFen(this.config.startFen ?? START_FEN);
    this.phase = 'playing';
    this.end = null;
    this.moves = [];
    this.startedAt = Date.now();
    this.endedAt = null;
    this.emit();
  }

  /** Update display names (e.g. once a P2P peer identifies). */
  rename(whiteName: string, blackName: string): void {
    this.config.whiteName = whiteName;
    this.config.blackName = blackName;
    this.emit();
  }

  private finish(winner: GameWinner, reason: EndReason): void {
    this.phase = 'ended';
    this.end = { winner, reason };
    this.endedAt = Date.now();
    this.emit(); // resign/draw/disconnect end games outside applyMove — UI must see it
  }

  /** Undo n half-moves (takeback). */
  undoPlies(n: number): boolean {
    if (n <= 0 || this.position.ply === 0) return false;
    const count = Math.min(n, this.position.ply);
    this.position.undoMany(count);
    this.moves.length -= count;
    if (this.phase === 'ended') {
      this.phase = 'playing';
      this.end = null;
      this.endedAt = null;
    }
    this.emit();
    return true;
  }

  get durationMs(): number {
    return (this.endedAt ?? Date.now()) - this.startedAt;
  }

  /** True if the side to move at `ply` was white. */
  static whiteToMoveAtPly(ply: number): boolean {
    return ply % 2 === 0;
  }

  static algebraicOf = algebraic;
}
