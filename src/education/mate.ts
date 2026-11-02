import { Position } from '../chess/position';
import { Color, encodeMoveObj, moveToUci } from '../chess/constants';

export interface MateRequest {
  type: 'verify' | 'hint';
  fen: string;
  movesLeft: number;
  uci?: string;
}
export interface MateAnswer {
  status: 'accepted' | 'rejected' | 'limit' | 'error';
  complete: boolean;
  reply?: string;
  hint?: string;
}
interface Proof { distance: number; line: string[] }
interface Budget { nodes: number; maxNodes: number; deadline: number; memo: Map<string, Proof | null> }
class ProofLimit extends Error {}

function prove(position: Position, attacker: Color, plies: number, budget: Budget): Proof | null {
  budget.nodes++;
  if (budget.nodes > budget.maxNodes || ((budget.nodes & 127) === 0 && performance.now() > budget.deadline)) throw new ProofLimit();
  if (plies <= 0 && !position.inCheck()) return null;
  const key = `${position.fen()}|${attacker}|${plies}`;
  if (budget.memo.has(key)) return budget.memo.get(key)!;
  const moves = position.getLegalMoves();
  if (moves.length === 0) return position.inCheck() && position.stm !== attacker ? { distance: 0, line: [] } : null;
  if (plies <= 0 || position.isDrawByFiftyMoves() || position.isInsufficientMaterial()) return null;
  const attacking = position.stm === attacker;
  if (attacking && plies > 1) {
    const priorities = new Map<number, number>();
    for (const move of moves) {
      const encoded = encodeMoveObj(move);
      const capture = position.pieceAt(move.to) !== 0;
      position.makeMove(encoded);
      const checking = position.inCheck();
      position.undoMove();
      priorities.set(encoded, (checking ? 100 : 0) + (move.promo ? 20 : 0) + (capture ? 10 : 0));
    }
    moves.sort((a, b) => priorities.get(encodeMoveObj(b))! - priorities.get(encodeMoveObj(a))!);
  }
  let best: Proof | null = null;
  for (const move of moves) {
    const encoded = encodeMoveObj(move);
    position.makeMove(encoded);
    let child: Proof | null;
    try { child = prove(position, attacker, plies - 1, budget); }
    finally { position.undoMove(); }
    if (attacking && child !== null) {
      best = { distance: child.distance + 1, line: [moveToUci(encoded), ...child.line] };
      break;
    }
    if (!attacking) {
      if (child === null) { budget.memo.set(key, null); return null; }
      if (best === null || child.distance + 1 > best.distance) {
        best = { distance: child.distance + 1, line: [moveToUci(encoded), ...child.line] };
      }
    }
  }
  budget.memo.set(key, best);
  return best;
}

export function assessMate(request: MateRequest, options: { maxNodes?: number; maxMs?: number } = {}): MateAnswer {
  try {
    if (!Number.isInteger(request.movesLeft) || request.movesLeft < 1 || request.movesLeft > 3) return { status: 'error', complete: false };
    const position = Position.fromFen(request.fen);
    const attacker = position.stm;
    const budget: Budget = {
      nodes: 0, maxNodes: options.maxNodes ?? 180_000,
      deadline: performance.now() + (options.maxMs ?? 3500), memo: new Map(),
    };
    if (request.type === 'hint') {
      const proof = prove(position, attacker, request.movesLeft * 2 - 1, budget);
      return proof?.line[0]
        ? { status: 'accepted', complete: false, hint: proof.line[0] }
        : { status: 'rejected', complete: false };
    }
    const move = position.uciToMove(request.uci ?? '');
    if (move === null) return { status: 'rejected', complete: false };
    position.makeMove(move);
    if (position.isCheckmate()) return { status: 'accepted', complete: true };
    const proof = prove(position, attacker, (request.movesLeft - 1) * 2, budget);
    return proof?.line[0]
      ? { status: 'accepted', complete: false, reply: proof.line[0] }
      : { status: 'rejected', complete: false };
  } catch (error) {
    return { status: error instanceof ProofLimit ? 'limit' : 'error', complete: false };
  }
}
