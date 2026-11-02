import { Color, other } from '../chess/constants';
import { GameController, EndReason, GameWinner } from '../game/GameController';

export const PEER_VERSION = 2;
export const MAX_PEER_FRAME = 65_536;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const ID = /^[a-z0-9-]{1,80}$/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const END_REASONS = new Set(['', 'checkmate', 'stalemate', 'threefold', 'fifty-move', 'insufficient', 'agreement', 'resign', 'disconnect']);
const ACTIONS = new Set(['resign', 'draw-offer', 'draw-accept', 'draw-decline', 'rematch-offer', 'rematch-accept', 'rematch-decline', 'rejected']);
type Action = 'resign' | 'draw-offer' | 'draw-accept' | 'draw-decline' | 'rematch-offer' | 'rematch-accept' | 'rematch-decline' | 'rejected';
export type NetState = {
  t: 'state'; gameId: string; moves: string[]; whiteName: string; blackName: string;
  winner: GameWinner; reason: EndReason | ''; turn: Color;
};
export type PeerMessage = NetState
  | { t: 'hello'; name: string }
  | { t: 'start'; gameId: string; guestColor: Color; hostName: string }
  | { t: 'try'; gameId: string; ply: number; uci: string }
  | { t: Action; gameId: string };

export const validPeerName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 60 && value.trim() === value && !CONTROL.test(value);
export function cleanPeerName(value: string, fallback: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, 60) || fallback;
}

export function parsePeerMessage(value: unknown): PeerMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>;
  if (m.v !== PEER_VERSION || typeof m.t !== 'string') return null;
  if (m.t === 'hello') return validPeerName(m.name) ? { t: 'hello', name: m.name } : null;
  if (typeof m.gameId !== 'string' || !ID.test(m.gameId)) return null;
  const gameId = m.gameId;
  if (m.t === 'start') {
    return validPeerName(m.hostName) && (m.guestColor === 0 || m.guestColor === 1)
      ? { t: 'start', gameId, guestColor: m.guestColor, hostName: m.hostName } : null;
  }
  if (m.t === 'try') {
    return typeof m.uci === 'string' && UCI.test(m.uci) && typeof m.ply === 'number' && Number.isSafeInteger(m.ply) && m.ply >= 0 && m.ply < 12_000
      ? { t: 'try', gameId, ply: m.ply, uci: m.uci } : null;
  }
  if (m.t === 'state') {
    if (typeof m.moves !== 'string' || m.moves.length > MAX_PEER_FRAME || !validPeerName(m.whiteName) || !validPeerName(m.blackName)) return null;
    const moves = m.moves ? m.moves.split(' ') : [];
    if (moves.length > 12_000 || moves.some((uci) => !UCI.test(uci))) return null;
    if (m.winner !== null && m.winner !== 'white' && m.winner !== 'black') return null;
    if (typeof m.reason !== 'string' || !END_REASONS.has(m.reason) || (m.turn !== 0 && m.turn !== 1)) return null;
    return { t: 'state', gameId, moves, whiteName: m.whiteName, blackName: m.blackName, winner: m.winner, reason: m.reason as NetState['reason'], turn: m.turn };
  }
  return ACTIONS.has(m.t) ? { t: m.t as Action, gameId } : null;
}

export function encodePeerMessage(message: PeerMessage): string {
  return JSON.stringify({ ...message, ...(message.t === 'state' ? { moves: message.moves.join(' ') } : {}), v: PEER_VERSION });
}

export function acceptGuestMove(controller: GameController, message: Extract<PeerMessage, { t: 'try' }>, hostColor: Color, gameId: string) {
  if (message.gameId !== gameId || message.ply !== controller.moveCount || controller.phase !== 'playing' || controller.turn !== other(hostColor)) return null;
  return controller.applyUci(message.uci);
}

/** Validate a complete update on a fork before changing the visible controller. */
export function applyPeerState(controller: GameController, net: NetState, gameId: string, guestColor: Color, pendingMove: string | null): boolean {
  if (net.gameId !== gameId || net.whiteName !== controller.config.whiteName || net.blackName !== controller.config.blackName) return false;
  const before = controller.moveCount;
  if (net.moves.length < before || net.moves.length > before + 1) return false;
  for (let i = 0; i < before; i++) if (net.moves[i] !== controller.moves[i]!.uci) return false;
  if (net.moves.length > before && controller.turn === guestColor && net.moves[before] !== pendingMove) return false;
  const fork = new GameController({ ...controller.config });
  fork.position = controller.position.clone(); fork.moves = controller.moves.slice();
  fork.phase = controller.phase; fork.end = controller.end ? { ...controller.end } : null;
  fork.startedAt = controller.startedAt; fork.endedAt = controller.endedAt;
  for (let i = before; i < net.moves.length; i++) if (!fork.applyUci(net.moves[i]!)) return false;
  if (fork.turn !== net.turn) return false;
  if (!fork.end && net.reason) {
    if (net.reason === 'agreement' && net.winner === null) fork.drawByAgreement();
    else if ((net.reason === 'resign' || net.reason === 'disconnect') && net.winner !== null) {
      const loser = net.winner === 'white' ? 1 : 0;
      if (net.reason === 'resign') fork.resign(loser); else fork.endByDisconnect(loser);
    } else return false;
  }
  if ((fork.end?.reason ?? '') !== net.reason || (fork.end?.winner ?? null) !== net.winner) return false;
  if (net.moves.length === before && (controller.end?.reason ?? '') === net.reason && (controller.end?.winner ?? null) === net.winner) return true;
  controller.position = fork.position; controller.moves = fork.moves;
  controller.phase = fork.phase; controller.end = fork.end; controller.endedAt = fork.endedAt;
  controller.rename(net.whiteName, net.blackName);
  return true;
}
