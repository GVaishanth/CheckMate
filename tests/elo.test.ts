import { describe, expect, it } from 'vitest';
import { ELO_ROUNDS } from '../src/data/elo';
import { Position } from '../src/chess/position';
import { WHITE, BLACK } from '../src/chess/constants';
import { GameController } from '../src/game/GameController';
import { assessMate } from '../src/education/mate';

describe('Elo assessment positions', () => {
  it.each(ELO_ROUNDS)('$id starts with the advertised player and a legal target', (round) => {
    const pos = Position.fromFen(round.fen);
    expect(pos.stm).toBe(round.sideToMove === 'white' ? WHITE : BLACK);
    expect(pos.getLegalMoves().length).toBeGreaterThan(0);
    if (round.bestMove) expect(pos.uciToMove(round.bestMove)).not.toBeNull();
  });
  it.each(ELO_ROUNDS.filter((round) => round.kind === 'mate'))('$id really forces mate within the advertised distance', (round) => {
    expect(assessMate({ type: 'verify', fen: round.fen, uci: round.bestMove, movesLeft: round.mateIn! }).status).toBe('accepted');
  });
  it('counts player moves correctly from either root side', () => {
    expect([0, 1, 2].map((ply) => GameController.whiteToMoveAtPly(ply))).toEqual([true, false, true]);
    expect([0, 1, 2].map((ply) => GameController.whiteToMoveAtPly(ply, BLACK))).toEqual([false, true, false]);
  });
});
