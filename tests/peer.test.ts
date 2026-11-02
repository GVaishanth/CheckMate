import { describe, expect, it } from 'vitest';
import { decodeConnectionCode, encodeConnectionCode } from '../src/multiplayer/peer';
import { acceptGuestMove, applyPeerState, encodePeerMessage, parsePeerMessage, NetState, PEER_VERSION } from '../src/multiplayer/protocol';
import { GameController } from '../src/game/GameController';

const raw = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const controller = () => new GameController({ whiteName: 'Host', blackName: 'Guest' });
const state = (moves: string[], extra: Partial<NetState> = {}): NetState => ({ t: 'state', gameId: 'game-1', moves, whiteName: 'Host', blackName: 'Guest', winner: null, reason: '', turn: moves.length % 2 ? 1 : 0, ...extra });

describe('peer input boundaries', () => {
  it('round-trips Unicode names without trusting JSON types', () => {
    expect(decodeConnectionCode(encodeConnectionCode('v=0\r\ns=session\r\n', 'host', 'வீரர்'))).toEqual({ sdp: 'v=0\r\ns=session\r\n', role: 'host', name: 'வீரர்' });
  });
  it.each([null, [], { v: PEER_VERSION, r: 'x', n: 'P', s: 'v=0' }, { v: PEER_VERSION, r: 'h', n: {}, s: 'v=0' }, { v: PEER_VERSION, r: 'h', n: 'P', s: {} }, { v: 1, r: 'h', n: 'P', s: 'v=0' }])('rejects malformed connection data %j', (value) => {
    expect(() => decodeConnectionCode(raw(value))).toThrow();
  });
  it('bounds connection codes before decoding', () => expect(() => decodeConnectionCode('A'.repeat(100_000))).toThrow());
  it.each([null, [], 42, { v: PEER_VERSION, t: 'hello', name: {} }, { v: PEER_VERSION, t: 'start', gameId: 'game-1', guestColor: 'black', hostName: 'P' }, { v: PEER_VERSION, t: 'try', gameId: 'game-1', ply: -1, uci: 'e2e4' }, { v: PEER_VERSION, t: 'try', gameId: 'game-1', ply: 0, uci: [] }, { v: PEER_VERSION, t: 'hello', name: 'P\nQ' }, { v: PEER_VERSION, ...state([]), moves: [{}] }])('ignores malformed frame %j', (value) => {
    expect(parsePeerMessage(value)).toBeNull();
  });
  it('round-trips compact authoritative state without remote SAN strings', () => {
    const message = state(['e2e4', 'e7e5']);
    expect(parsePeerMessage(JSON.parse(encodePeerMessage(message)))).toEqual(message);
  });
});

describe('host move ownership', () => {
  it('rejects a guest trying to play the host seat', () => {
    const c = controller();
    expect(acceptGuestMove(c, { t: 'try', gameId: 'game-1', ply: 0, uci: 'e2e4' }, 0, 'game-1')).toBeNull();
    expect(c.moveCount).toBe(0);
  });
  it('accepts only a legal, current-game move at the expected ply', () => {
    const c = controller(); c.applyUci('e2e4');
    expect(acceptGuestMove(c, { t: 'try', gameId: 'old', ply: 1, uci: 'e7e5' }, 0, 'game-1')).toBeNull();
    expect(acceptGuestMove(c, { t: 'try', gameId: 'game-1', ply: 0, uci: 'e7e5' }, 0, 'game-1')).toBeNull();
    expect(acceptGuestMove(c, { t: 'try', gameId: 'game-1', ply: 1, uci: 'e7e5' }, 0, 'game-1')).not.toBeNull();
  });
});

describe('atomic guest synchronization', () => {
  it('commits a legal opponent move', () => {
    const c = controller(); expect(applyPeerState(c, state(['e2e4']), 'game-1', 1, null)).toBe(true); expect(c.moveCount).toBe(1);
  });
  it('requires a pending request before applying a guest-seat move', () => {
    const c = controller(); expect(applyPeerState(c, state(['e2e4']), 'game-1', 0, null)).toBe(false);
    expect(applyPeerState(c, state(['e2e4']), 'game-1', 0, 'e2e4')).toBe(true);
  });
  it.each([
    state(['e2e5']), state(['e2e4', 'e7e5']), state(['e2e4'], { turn: 0 }),
    state(['e2e4'], { winner: 'white', reason: 'checkmate' }), state([], { gameId: 'old' }),
    state([], { whiteName: 'Impostor' }),
  ])('rejects invalid state without partially changing the board %j', (net) => {
    const c = controller(), fen = c.position.fen();
    expect(applyPeerState(c, net, 'game-1', 1, null)).toBe(false); expect(c.position.fen()).toBe(fen); expect(c.moveCount).toBe(0);
  });
  it('does not rewrite a previously accepted prefix or reset through a state frame', () => {
    const c = controller(); c.applyUci('e2e4'); const fen = c.position.fen();
    expect(applyPeerState(c, state(['d2d4']), 'game-1', 1, null)).toBe(false);
    expect(applyPeerState(c, state([]), 'game-1', 1, null)).toBe(false); expect(c.position.fen()).toBe(fen);
  });
  it.each(['white', 'black'] as const)('uses the authoritative %s winner for resignation', (winner) => {
    const c = controller(); expect(applyPeerState(c, state([], { reason: 'resign', winner }), 'game-1', 1, null)).toBe(true);
    expect(c.end).toEqual({ reason: 'resign', winner });
  });
  it('accepts and preserves an agreed draw', () => {
    const c = controller(); expect(applyPeerState(c, state([], { reason: 'agreement' }), 'game-1', 1, null)).toBe(true);
    expect(c.end).toEqual({ winner: null, reason: 'agreement' });
  });
});

it('does not notify or replace the board on a duplicate state during rematch selection', () => {
  const game = controller(), original = game.position, version = game.getVersion();
  expect(applyPeerState(game, state([]), 'game-1', 0, null)).toBe(true);
  expect(game.position).toBe(original);
  expect(game.getVersion()).toBe(version);
});
